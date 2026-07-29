import type Database from "better-sqlite3";

export class AuditEventRepository {
  constructor(private readonly database: Database.Database) {}

  append(input: {
    readonly action: string;
    readonly actorUserId: string | null;
    readonly bookId?: number;
    readonly jobId?: string;
    readonly nowMs: number;
    readonly safeMetadata?: Readonly<
      Record<string, string | number | boolean | null>
    >;
    readonly versionId?: string;
  }): number {
    const result = this.database
      .prepare(
        `INSERT INTO audit_events
          (actor_user_id, action, book_id, version_id, job_id,
           safe_metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.actorUserId,
        input.action,
        input.bookId ?? null,
        input.versionId ?? null,
        input.jobId ?? null,
        JSON.stringify(input.safeMetadata ?? {}),
        input.nowMs,
      );
    return Number(result.lastInsertRowid);
  }
}
