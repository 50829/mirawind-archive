import type Database from "better-sqlite3";

import { type createHttpAuth } from "@/auth/server";
import { AuditEventRepository } from "@/db/repositories/audit-events";

export type FinalPasskeyDeletionResult =
  | { readonly deleted: true }
  | {
      readonly deleted: false;
      readonly reason: "NOT_FOUND" | "NOT_FINAL_PASSKEY";
    };

export async function deleteFinalPasskey(input: {
  readonly auth: ReturnType<typeof createHttpAuth>;
  readonly database: Database.Database;
  readonly nowMs: number;
  readonly passkeyId: string;
  readonly userId: string;
}): Promise<FinalPasskeyDeletionResult> {
  input.database.exec("BEGIN IMMEDIATE");
  try {
    const target = input.database
      .prepare("SELECT userId FROM passkey WHERE id = ?")
      .get(input.passkeyId) as { userId: string } | undefined;
    if (!target || target.userId !== input.userId) {
      input.database.exec("ROLLBACK");
      return { deleted: false, reason: "NOT_FOUND" };
    }
    const count = input.database
      .prepare("SELECT COUNT(*) AS count FROM passkey WHERE userId = ?")
      .get(input.userId) as { count: number };
    if (count.count !== 1) {
      input.database.exec("ROLLBACK");
      return { deleted: false, reason: "NOT_FINAL_PASSKEY" };
    }

    const context = await input.auth.$context;
    await context.adapter.delete({
      model: "passkey",
      where: [{ field: "id", value: input.passkeyId }],
    });
    new AuditEventRepository(input.database).append({
      action: "passkey.delete-final",
      actorUserId: input.userId,
      nowMs: input.nowMs,
    });
    input.database.exec("COMMIT");
    return { deleted: true };
  } catch (error) {
    if (input.database.inTransaction) input.database.exec("ROLLBACK");
    throw error;
  }
}
