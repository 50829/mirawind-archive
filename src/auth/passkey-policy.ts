import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import type Database from "better-sqlite3";

import { AuditEventRepository } from "@/db/repositories/audit-events";
import { InstallationRepository } from "@/db/repositories/installation";
import { withImmediateTransaction } from "@/db/transaction/immediate";

const mutationPaths = new Set([
  "/passkey/delete-passkey",
  "/passkey/generate-register-options",
  "/passkey/update-passkey",
  "/passkey/verify-registration",
]);

export type PasskeyMutationDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        | "FINAL_PASSKEY_REQUIRES_PASSWORD"
        | "NOT_SOLE_ADMINISTRATOR"
        | "PASSKEY_LIMIT_REACHED"
        | "SESSION_NOT_FRESH"
        | "UNAUTHENTICATED";
    };

export function authorizePasskeyMutation(input: {
  readonly adminUserId: string | null;
  readonly authenticatedAtMs: number | null;
  readonly nowMs: number;
  readonly passkeyCount: number;
  readonly path: string;
  readonly userId: string | null;
}): PasskeyMutationDecision {
  if (!input.userId || input.authenticatedAtMs === null) {
    return { allowed: false, reason: "UNAUTHENTICATED" };
  }
  if (!input.adminUserId || input.userId !== input.adminUserId) {
    return { allowed: false, reason: "NOT_SOLE_ADMINISTRATOR" };
  }
  if (input.nowMs - input.authenticatedAtMs > 300_000) {
    return { allowed: false, reason: "SESSION_NOT_FRESH" };
  }
  if (
    (input.path === "/passkey/generate-register-options" ||
      input.path === "/passkey/verify-registration") &&
    input.passkeyCount >= 10
  ) {
    return { allowed: false, reason: "PASSKEY_LIMIT_REACHED" };
  }
  if (input.path === "/passkey/delete-passkey" && input.passkeyCount <= 1) {
    return { allowed: false, reason: "FINAL_PASSKEY_REQUIRES_PASSWORD" };
  }
  return { allowed: true };
}

function policyError(
  reason: Exclude<PasskeyMutationDecision, { allowed: true }>["reason"],
): APIError {
  switch (reason) {
    case "UNAUTHENTICATED":
      return APIError.from("UNAUTHORIZED", {
        code: reason,
        message: "Authentication is required.",
      });
    case "SESSION_NOT_FRESH":
      return APIError.from("FORBIDDEN", {
        code: reason,
        message: "Recent authentication is required.",
      });
    case "NOT_SOLE_ADMINISTRATOR":
      return APIError.from("FORBIDDEN", {
        code: reason,
        message: "Administrator access is required.",
      });
    default:
      return APIError.from("CONFLICT", {
        code: reason,
        message:
          reason === "PASSKEY_LIMIT_REACHED"
            ? "The ten-Passkey limit has been reached."
            : "The final Passkey requires password-verified deletion.",
      });
  }
}

function passkeyCount(
  database: Database.Database,
  userId: string | null,
): number {
  if (!userId) return 0;
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM passkey WHERE userId = ?")
    .get(userId) as { count: number };
  return row.count;
}

export function recordPasskeyUse(input: {
  readonly credentialId: string;
  readonly database: Database.Database;
  readonly nowMs: number;
}): boolean {
  const result = input.database
    .prepare(
      `INSERT INTO passkey_usage (passkey_id, last_used_at)
       SELECT id, ? FROM passkey WHERE credentialID = ?
       ON CONFLICT(passkey_id)
       DO UPDATE SET last_used_at = excluded.last_used_at`,
    )
    .run(input.nowMs, input.credentialId);
  return result.changes === 1;
}

export function deleteNonFinalPasskey(input: {
  readonly database: Database.Database;
  readonly nowMs: number;
  readonly passkeyId: string;
  readonly userId: string;
}): void {
  withImmediateTransaction(input.database, () => {
    const target = input.database
      .prepare("SELECT userId FROM passkey WHERE id = ?")
      .get(input.passkeyId) as { userId: string } | undefined;
    if (!target || target.userId !== input.userId) {
      throw APIError.from("NOT_FOUND", {
        code: "PASSKEY_NOT_FOUND",
        message: "The Passkey was not found.",
      });
    }
    if (passkeyCount(input.database, input.userId) <= 1) {
      throw policyError("FINAL_PASSKEY_REQUIRES_PASSWORD");
    }
    input.database
      .prepare("DELETE FROM passkey WHERE id = ? AND userId = ?")
      .run(input.passkeyId, input.userId);
    new AuditEventRepository(input.database).append({
      action: "passkey.delete",
      actorUserId: input.userId,
      nowMs: input.nowMs,
    });
  });
}

export function createPasskeyPolicyHooks(database: Database.Database): {
  readonly after: ReturnType<typeof createAuthMiddleware>;
  readonly before: ReturnType<typeof createAuthMiddleware>;
} {
  return {
    before: createAuthMiddleware(async (context) => {
      if (!mutationPaths.has(context.path)) return undefined;
      const session = await getSessionFromCtx(context);
      const userId = session?.user.id ?? null;
      const decision = authorizePasskeyMutation({
        adminUserId: new InstallationRepository(database).adminUserId(),
        authenticatedAtMs: session
          ? new Date(session.session.createdAt).getTime()
          : null,
        nowMs: Date.now(),
        passkeyCount: passkeyCount(database, userId),
        path: context.path,
        userId,
      });
      if (!decision.allowed) throw policyError(decision.reason);
      if (!userId) throw policyError("UNAUTHENTICATED");
      if (context.path === "/passkey/delete-passkey") {
        const body = context.body as { id?: unknown } | undefined;
        if (typeof body?.id !== "string") {
          throw APIError.from("BAD_REQUEST", {
            code: "INVALID_PASSKEY_ID",
            message: "A Passkey ID is required.",
          });
        }
        deleteNonFinalPasskey({
          database,
          nowMs: Date.now(),
          passkeyId: body.id,
          userId,
        });
        return context.json({ status: true });
      }
      return undefined;
    }),
    after: createAuthMiddleware(async (context) => {
      const action = {
        "/passkey/update-passkey": "passkey.rename",
        "/passkey/verify-registration": "passkey.add",
      }[context.path];
      if (!action) return;
      const session = await getSessionFromCtx(context);
      if (!session) return;
      new AuditEventRepository(database).append({
        action,
        actorUserId: session.user.id,
        nowMs: Date.now(),
      });
    }),
  };
}
