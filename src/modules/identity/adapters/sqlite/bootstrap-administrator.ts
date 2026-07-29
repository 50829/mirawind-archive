import type Database from "better-sqlite3";

import { type createSetupAuth } from "@/modules/identity/adapters/better-auth/setup-auth";
import { appendIdentityAuditEvent } from "@/modules/identity/adapters/sqlite/identity-audit-events";
import { InstallationRepository } from "@/modules/identity/adapters/sqlite/installation";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export async function bootstrapAdministrator(input: {
  readonly auth: ReturnType<typeof createSetupAuth>;
  readonly database: Database.Database;
  readonly displayName: string;
  readonly email: string;
  readonly nowMs: number;
  readonly password: string;
}): Promise<{ readonly userId: string }> {
  const installation = new InstallationRepository(input.database);
  installation.ensure(input.nowMs);
  if (installation.adminUserId() !== null) {
    throw new Error("ADMIN_ALREADY_INITIALIZED");
  }
  const existingUsers = input.database
    .prepare('SELECT COUNT(*) AS count FROM "user"')
    .get() as { count: number };
  if (existingUsers.count !== 0) throw new Error("UNRELATED_AUTH_USER_EXISTS");

  const result = await input.auth.api.signUpEmail({
    body: {
      email: input.email,
      name: input.displayName,
      password: input.password,
    },
  });
  const context = await input.auth.$context;
  try {
    await context.internalAdapter.deleteUserSessions(result.user.id);
    withImmediateTransaction(input.database, () => {
      installation.registerSoleAdministrator(result.user.id, input.nowMs);
      appendIdentityAuditEvent(input.database, {
        action: "admin.bootstrap",
        actorUserId: result.user.id,
        nowMs: input.nowMs,
      });
    });
    return { userId: result.user.id };
  } catch (error) {
    await context.internalAdapter.deleteUser(result.user.id);
    throw error;
  }
}
