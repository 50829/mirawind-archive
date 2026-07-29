import type Database from "better-sqlite3";

export function appendIdentityAuditEvent(
  database: Database.Database,
  input: {
    readonly action: string;
    readonly actorUserId: string;
    readonly nowMs: number;
    readonly safeMetadata?: Readonly<
      Record<string, string | number | boolean | null>
    >;
  },
): void {
  const changed = database
    .prepare(
      `INSERT INTO audit_events (
        actor_user_id, action, book_id, version_id, job_id,
        safe_metadata_json, created_at
      ) VALUES (?, ?, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      input.actorUserId,
      input.action,
      JSON.stringify(input.safeMetadata ?? {}),
      input.nowMs,
    );
  if (changed.changes !== 1) throw new Error("IDENTITY_AUDIT_INSERT_FAILED");
}
