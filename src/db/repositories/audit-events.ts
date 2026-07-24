import type Database from "better-sqlite3";

export class AuditEventRepository {
  constructor(private readonly database: Database.Database) {}

  append(input: {
    readonly action: string;
    readonly actorUserId: string | null;
    readonly nowMs: number;
    readonly safeMetadata?: Readonly<
      Record<string, string | number | boolean | null>
    >;
  }): number {
    const result = this.database
      .prepare(
        `INSERT INTO audit_events
          (actor_user_id, action, safe_metadata_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.actorUserId,
        input.action,
        JSON.stringify(input.safeMetadata ?? {}),
        input.nowMs,
      );
    return Number(result.lastInsertRowid);
  }
}
