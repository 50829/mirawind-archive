import type Database from "better-sqlite3";

export class InstallationRepository {
  constructor(private readonly database: Database.Database) {}

  ensure(nowMs: number): void {
    this.database
      .prepare(
        `INSERT INTO installation
         (id, admin_user_id, schema_version, created_at, updated_at)
         VALUES (1, NULL, 4, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(nowMs, nowMs);
  }

  adminUserId(): string | null {
    const row = this.database
      .prepare("SELECT admin_user_id FROM installation WHERE id = 1")
      .get() as { admin_user_id: string | null } | undefined;
    return row?.admin_user_id ?? null;
  }

  registerSoleAdministrator(userId: string, nowMs: number): void {
    const result = this.database
      .prepare(
        `UPDATE installation SET admin_user_id = ?, updated_at = ?
         WHERE id = 1 AND admin_user_id IS NULL
           AND (SELECT COUNT(*) FROM "user") = 1
           AND EXISTS (SELECT 1 FROM "user" WHERE id = ?)`,
      )
      .run(userId, nowMs, userId);
    if (result.changes !== 1) throw new Error("ADMIN_BOOTSTRAP_PRECONDITION");
  }
}
