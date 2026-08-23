import type Database from "better-sqlite3";

import { type createSetupAuth } from "../better-auth/setup-auth";
import { appendIdentityAuditEvent } from "./identity-audit-events";
import { InstallationRepository } from "./installation";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export async function recoverAdministrator(input: {
  readonly auth: ReturnType<typeof createSetupAuth>;
  readonly database: Database.Database;
  readonly nowMs: number;
  readonly password: string;
}): Promise<{
  readonly deletedPasskeys: number;
  readonly revokedSessions: number;
  readonly userId: string;
}> {
  const userId = new InstallationRepository(input.database).adminUserId();
  if (!userId) throw new Error("ADMIN_NOT_INITIALIZED");

  const context = await input.auth.$context;
  const passwordHash = await context.password.hash(input.password);
  return withImmediateTransaction(input.database, () => {
    const account = input.database
      .prepare(
        `UPDATE account SET password = ?, updatedAt = ?
         WHERE userId = ? AND providerId = 'credential'`,
      )
      .run(passwordHash, input.nowMs, userId);
    if (account.changes !== 1) throw new Error("CREDENTIAL_ACCOUNT_NOT_FOUND");
    const sessions = input.database
      .prepare("DELETE FROM session WHERE userId = ?")
      .run(userId);
    const passkeys = input.database
      .prepare("DELETE FROM passkey WHERE userId = ?")
      .run(userId);
    appendIdentityAuditEvent(input.database, {
      action: "admin.recover",
      actorUserId: userId,
      nowMs: input.nowMs,
      safeMetadata: {
        passkeys_deleted: passkeys.changes,
        sessions_revoked: sessions.changes,
      },
    });
    return {
      deletedPasskeys: passkeys.changes,
      revokedSessions: sessions.changes,
      userId,
    };
  });
}
