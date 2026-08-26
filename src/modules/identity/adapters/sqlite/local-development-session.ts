import type Database from "better-sqlite3";

import {
  localDevelopmentSessionId,
  type RequestSession,
} from "../../application/identity-api";

export function createLocalDevelopmentSession(
  database: Database.Database,
  nowMs = Date.now(),
): RequestSession | null {
  const administrator = database
    .prepare(
      `SELECT users.id, users.email, users.name
       FROM installation
       INNER JOIN "user" AS users ON users.id = installation.admin_user_id
       WHERE installation.id = 1
         AND (SELECT COUNT(*) FROM "user") = 1`,
    )
    .get() as
    | { readonly email: string; readonly id: string; readonly name: string }
    | undefined;
  if (!administrator) return null;
  return Object.freeze({
    authenticatedAtMs: nowMs,
    expiresAtMs: Number.MAX_SAFE_INTEGER,
    sessionId: localDevelopmentSessionId,
    user: Object.freeze({ ...administrator }),
  });
}
