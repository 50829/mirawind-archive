import type Database from "better-sqlite3";

import { type createSetupAuth } from "../../auth/setup-server.js";
import { AuditEventRepository } from "../../db/repositories/audit-events.js";
import { InstallationRepository } from "../../db/repositories/installation.js";
import { withImmediateTransaction } from "../../db/transaction/immediate.js";

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
      new AuditEventRepository(input.database).append({
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
