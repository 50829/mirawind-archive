import type Database from "better-sqlite3";

import {
  isDeletionSafeErrorCode,
  type BookDeletionState,
  type DeletionSafeErrorCode,
} from "@/domain/book-deletion";

interface DeletionRow {
  book_id: number;
  cleanup_job_id: string;
  completed_at: number | null;
  id: string;
  idempotency_key_hash: string;
  request_fingerprint: string;
  requested_at: number;
  requested_by_user_id: string;
  safe_error_code: string | null;
  started_at: number | null;
  state: BookDeletionState;
  updated_at: number;
}

export interface BookDeletionRecord {
  readonly bookId: number;
  readonly cleanupJobId: string;
  readonly completedAtMs: number | null;
  readonly id: string;
  readonly idempotencyKeyHash: string;
  readonly requestFingerprint: string;
  readonly requestedAtMs: number;
  readonly requestedByUserId: string;
  readonly safeErrorCode: DeletionSafeErrorCode | null;
  readonly startedAtMs: number | null;
  readonly state: BookDeletionState;
  readonly updatedAtMs: number;
}

function mapDeletion(row: DeletionRow): BookDeletionRecord {
  if (row.safe_error_code && !isDeletionSafeErrorCode(row.safe_error_code)) {
    throw new Error("DELETION_SAFE_ERROR_CODE_INVALID");
  }
  return Object.freeze({
    bookId: row.book_id,
    cleanupJobId: row.cleanup_job_id,
    completedAtMs: row.completed_at,
    id: row.id,
    idempotencyKeyHash: row.idempotency_key_hash,
    requestFingerprint: row.request_fingerprint,
    requestedAtMs: row.requested_at,
    requestedByUserId: row.requested_by_user_id,
    safeErrorCode: row.safe_error_code as DeletionSafeErrorCode | null,
    startedAtMs: row.started_at,
    state: row.state,
    updatedAtMs: row.updated_at,
  });
}

export class BookDeletionRepository {
  constructor(private readonly database: Database.Database) {}

  findByBookId(bookId: number): BookDeletionRecord | null {
    const row = this.database
      .prepare("SELECT * FROM book_deletions WHERE book_id = ?")
      .get(bookId) as DeletionRow | undefined;
    return row ? mapDeletion(row) : null;
  }

  findById(id: string): BookDeletionRecord | null {
    const row = this.database
      .prepare("SELECT * FROM book_deletions WHERE id = ?")
      .get(id) as DeletionRow | undefined;
    return row ? mapDeletion(row) : null;
  }

  findByIdempotencyHash(hash: string): BookDeletionRecord | null {
    const row = this.database
      .prepare("SELECT * FROM book_deletions WHERE idempotency_key_hash = ?")
      .get(hash) as DeletionRow | undefined;
    return row ? mapDeletion(row) : null;
  }

  requireByCleanupJobId(jobId: string): BookDeletionRecord {
    const row = this.database
      .prepare("SELECT * FROM book_deletions WHERE cleanup_job_id = ?")
      .get(jobId) as DeletionRow | undefined;
    if (!row) throw new Error("CLEANUP_INVALID_STATE");
    return mapDeletion(row);
  }

  markPurging(jobId: string, nowMs: number): BookDeletionRecord {
    const changed = this.database
      .prepare(
        `UPDATE book_deletions
         SET state = 'purging', started_at = COALESCE(started_at, ?),
             safe_error_code = NULL, updated_at = ?
         WHERE cleanup_job_id = ? AND state IN ('pending', 'failed', 'purging')`,
      )
      .run(nowMs, nowMs, jobId);
    if (changed.changes !== 1) throw new Error("CLEANUP_INVALID_STATE");
    return this.requireByCleanupJobId(jobId);
  }

  markFailed(
    jobId: string,
    safeErrorCode: DeletionSafeErrorCode,
    nowMs: number,
  ): BookDeletionRecord {
    const changed = this.database
      .prepare(
        `UPDATE book_deletions
         SET state = 'failed', safe_error_code = ?, updated_at = ?
         WHERE cleanup_job_id = ? AND state != 'completed'`,
      )
      .run(safeErrorCode, nowMs, jobId);
    if (changed.changes !== 1) throw new Error("CLEANUP_INVALID_STATE");
    return this.requireByCleanupJobId(jobId);
  }

  completeContentPurge(input: {
    readonly bookId: number;
    readonly cleanupJobId: string;
    readonly nowMs: number;
  }): BookDeletionRecord {
    return this.database
      .transaction(() => {
        const deletion = this.requireByCleanupJobId(input.cleanupJobId);
        if (deletion.state === "completed") return deletion;
        if (deletion.bookId !== input.bookId) {
          throw new Error("CLEANUP_DATABASE_CONFLICT");
        }
        const active = this.database
          .prepare(
            `SELECT deletion_requested_at
             FROM books WHERE id = ?`,
          )
          .get(input.bookId) as
          { deletion_requested_at: number | null } | undefined;
        if (!active || active.deletion_requested_at === null) {
          throw new Error("CLEANUP_DATABASE_CONFLICT");
        }
        const importIds = (
          this.database
            .prepare(
              `SELECT DISTINCT imports.id
               FROM imports
               LEFT JOIN source_snapshots
                 ON source_snapshots.created_from_import_id = imports.id
               WHERE imports.book_id = ? OR source_snapshots.book_id = ?
               ORDER BY imports.id`,
            )
            .all(input.bookId, input.bookId) as { id: string }[]
        ).map((row) => row.id);
        const importPlaceholders = importIds.map(() => "?").join(", ");

        const relatedJobsSql = `
          SELECT id FROM jobs
          WHERE book_id = @bookId
             OR import_id IN (
               SELECT id FROM imports
               WHERE book_id = @bookId
                  OR id IN (
                    SELECT created_from_import_id
                    FROM source_snapshots WHERE book_id = @bookId
                  )
             )
             OR captured_source_id IN (
               SELECT id FROM source_snapshots WHERE book_id = @bookId
             )
             OR version_id IN (
               SELECT id FROM book_versions WHERE book_id = @bookId
             )
             OR captured_current_version_id IN (
               SELECT id FROM book_versions WHERE book_id = @bookId
             )`;
        this.database
          .prepare(
            `DELETE FROM audit_events
             WHERE book_id = @bookId
                OR version_id IN (
                  SELECT id FROM book_versions WHERE book_id = @bookId
                )
                OR job_id IN (${relatedJobsSql})`,
          )
          .run({ bookId: input.bookId });
        this.database
          .prepare("DELETE FROM search_fts WHERE book_id = ?")
          .run(input.bookId);
        this.database
          .prepare("DELETE FROM search_short_fields WHERE book_id = ?")
          .run(input.bookId);
        this.database
          .prepare(
            `UPDATE books
             SET draft_source_id = NULL, draft_config_revision = NULL,
                 ready_preview_revision = NULL, current_version_id = NULL
             WHERE id = ? AND deletion_requested_at IS NOT NULL`,
          )
          .run(input.bookId);
        this.database
          .prepare("DELETE FROM book_version_presentations WHERE book_id = ?")
          .run(input.bookId);
        this.database
          .prepare("DELETE FROM draft_previews WHERE book_id = ?")
          .run(input.bookId);

        this.database
          .prepare(
            `UPDATE jobs
             SET import_id = NULL, book_id = NULL, version_id = NULL,
                 captured_source_id = NULL, captured_config_revision = NULL,
                 captured_current_version_id = NULL,
                 progress_json = '{}', error_detail_json = NULL,
                 error_code = CASE
                   WHEN id != @cleanupJobId AND state != 'succeeded'
                     THEN 'JOB_SUBJECT_DELETED'
                   ELSE error_code
                 END
             WHERE id IN (${relatedJobsSql})`,
          )
          .run({
            bookId: input.bookId,
            cleanupJobId: input.cleanupJobId,
          });
        this.database
          .prepare(
            "UPDATE book_versions SET predecessor_version_id = NULL WHERE book_id = ?",
          )
          .run(input.bookId);
        this.database
          .prepare("DELETE FROM book_versions WHERE book_id = ?")
          .run(input.bookId);
        this.database
          .prepare("DELETE FROM original_files WHERE book_id = ?")
          .run(input.bookId);
        this.database
          .prepare("DELETE FROM config_revisions WHERE book_id = ?")
          .run(input.bookId);
        if (importIds.length > 0) {
          this.database
            .prepare(
              `UPDATE imports SET selected_candidate_id = NULL
               WHERE id IN (${importPlaceholders})`,
            )
            .run(...importIds);
          this.database
            .prepare(
              `DELETE FROM import_candidates
               WHERE import_id IN (${importPlaceholders})`,
            )
            .run(...importIds);
        }
        this.database
          .prepare("DELETE FROM source_snapshots WHERE book_id = ?")
          .run(input.bookId);
        if (importIds.length > 0) {
          this.database
            .prepare(`DELETE FROM imports WHERE id IN (${importPlaceholders})`)
            .run(...importIds);
        }
        const removed = this.database
          .prepare(
            "DELETE FROM books WHERE id = ? AND deletion_requested_at IS NOT NULL",
          )
          .run(input.bookId);
        if (removed.changes !== 1) {
          throw new Error("CLEANUP_DATABASE_CONFLICT");
        }
        const completed = this.database
          .prepare(
            `UPDATE book_deletions
             SET state = 'completed', safe_error_code = NULL,
                 completed_at = ?, updated_at = ?
             WHERE cleanup_job_id = ? AND state != 'completed'`,
          )
          .run(input.nowMs, input.nowMs, input.cleanupJobId);
        if (completed.changes !== 1) {
          throw new Error("CLEANUP_DATABASE_CONFLICT");
        }
        const integrity = this.database.pragma(
          "foreign_key_check",
        ) as unknown[];
        if (integrity.length > 0) {
          throw new Error("CLEANUP_DATABASE_INTEGRITY");
        }
        return this.requireByCleanupJobId(input.cleanupJobId);
      })
      .immediate();
  }
}
