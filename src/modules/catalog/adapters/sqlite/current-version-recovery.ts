import type Database from "better-sqlite3";

import type {
  CurrentBookVersion,
  CurrentVersionCatalogPort,
} from "../../application/catalog-api";

export class CurrentVersionCatalogRepository implements CurrentVersionCatalogPort {
  constructor(private readonly database: Database.Database) {}

  isCurrentVersion(input: {
    readonly bookId: number;
    readonly versionId: string;
  }): boolean {
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM books
           WHERE id = ? AND current_version_id = ?
             AND deletion_requested_at IS NULL`,
        )
        .get(input.bookId, input.versionId),
    );
  }

  listCurrentVersions(): readonly CurrentBookVersion[] {
    const rows = this.database
      .prepare(
        `SELECT id, current_version_id FROM books
         WHERE current_version_id IS NOT NULL
           AND deletion_requested_at IS NULL
         ORDER BY id`,
      )
      .all() as { id: number; current_version_id: string }[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          bookId: row.id,
          currentVersionId: row.current_version_id,
        }),
      ),
    );
  }

  markCurrentVersionUnavailable(input: {
    readonly bookId: number;
    readonly currentVersionId: string;
    readonly nowMs: number;
  }): void {
    const changed = this.database
      .prepare(
        `UPDATE books
         SET unavailable_reason = 'CURRENT_VERSION_CORRUPT', updated_at = ?
         WHERE id = ? AND current_version_id = ?
           AND deletion_requested_at IS NULL`,
      )
      .run(input.nowMs, input.bookId, input.currentVersionId);
    if (changed.changes !== 1) throw new Error("CURRENT_VERSION_RECOVERY_RACE");
    this.recordRecovery({ ...input, replacementVersionId: null });
  }

  replaceCurrentVersion(input: {
    readonly alias: string | null;
    readonly bookId: number;
    readonly currentVersionId: string;
    readonly nowMs: number;
    readonly replacementVersionId: string;
  }): void {
    const changed = this.database
      .prepare(
        `UPDATE books
         SET current_version_id = ?, alias = ?, unavailable_reason = NULL,
             updated_at = ?
         WHERE id = ? AND current_version_id = ?
           AND deletion_requested_at IS NULL`,
      )
      .run(
        input.replacementVersionId,
        input.alias,
        input.nowMs,
        input.bookId,
        input.currentVersionId,
      );
    if (changed.changes !== 1) throw new Error("CURRENT_VERSION_RECOVERY_RACE");
    this.recordRecovery(input);
  }

  private recordRecovery(input: {
    readonly bookId: number;
    readonly currentVersionId: string;
    readonly nowMs: number;
    readonly replacementVersionId: string | null;
  }): void {
    this.database
      .prepare(
        `INSERT INTO audit_events (
           actor_user_id, action, book_id, version_id, job_id,
           safe_metadata_json, created_at
         ) VALUES (NULL, 'book.version.recovered', ?, ?, NULL, ?, ?)`,
      )
      .run(
        input.bookId,
        input.replacementVersionId ?? input.currentVersionId,
        JSON.stringify({
          failed_version_id: input.currentVersionId,
          replacement_version_id: input.replacementVersionId,
        }),
        input.nowMs,
      );
  }
}
