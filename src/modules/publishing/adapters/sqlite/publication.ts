import type Database from "better-sqlite3";

import type { CrashPointInjector } from "@/modules/publishing/application/crash-points";
import { injectCrashPoint } from "@/modules/publishing/application/crash-points";
import { SafeApplicationError } from "@/domain/errors";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export function makeBookNonPublic(input: {
  readonly actorUserId: string | null;
  readonly bookId: number;
  readonly database: Database.Database;
  readonly nowMs: number;
  readonly visibility: "draft" | "private";
}): void {
  withImmediateTransaction(input.database, () => {
    const changed = input.database
      .prepare(
        `UPDATE books SET visibility = ?, updated_at = ?
         WHERE id = ? AND deletion_requested_at IS NULL`,
      )
      .run(input.visibility, input.nowMs, input.bookId);
    if (changed.changes !== 1) {
      throw new SafeApplicationError(
        "NOT_FOUND",
        "The book was not found.",
        404,
      );
    }
    input.database
      .prepare(
        `INSERT INTO audit_events (
          actor_user_id, action, book_id, version_id, job_id,
          safe_metadata_json, created_at
        ) VALUES (?, 'book.visibility.changed', ?, NULL, NULL, ?, ?)`,
      )
      .run(
        input.actorUserId,
        input.bookId,
        JSON.stringify({ visibility: input.visibility }),
        input.nowMs,
      );
  });
}

export async function publishReadyVersion(input: {
  readonly actorUserId: string | null;
  readonly crashPoint?: CrashPointInjector;
  readonly database: Database.Database;
  readonly jobId: string;
  readonly leaseOwner: string;
  readonly nowMs: number;
  readonly versionId: string;
}): Promise<void> {
  await injectCrashPoint(input.crashPoint, "before_current_pointer");
  withImmediateTransaction(input.database, () => {
    const capture = input.database
      .prepare(
        `SELECT
           jobs.state AS job_state,
           jobs.lease_owner,
           jobs.book_id,
           jobs.captured_source_id,
           jobs.captured_config_revision,
           jobs.captured_current_version_id,
           jobs.version_id AS job_version_id,
           books.draft_source_id,
           books.draft_config_revision,
           books.current_version_id,
           draft_previews.state AS preview_state,
           book_versions.state AS version_state,
           book_versions.source_id AS version_source_id,
           book_versions.config_revision AS version_config_revision,
           book_versions.predecessor_version_id,
           book_version_presentations.alias AS presentation_alias,
           book_version_presentations.projection_sha256
         FROM jobs
         JOIN books ON books.id = jobs.book_id
         JOIN book_versions ON book_versions.id = jobs.version_id
         LEFT JOIN book_version_presentations
           ON book_version_presentations.version_id = book_versions.id
          AND book_version_presentations.book_id = books.id
         LEFT JOIN draft_previews
           ON draft_previews.book_id = books.id
          AND draft_previews.config_revision = books.draft_config_revision
         WHERE jobs.id = ? AND book_versions.id = ?
           AND books.deletion_requested_at IS NULL`,
      )
      .get(input.jobId, input.versionId) as
      | {
          book_id: number;
          captured_config_revision: number;
          captured_current_version_id: string | null;
          captured_source_id: string;
          current_version_id: string | null;
          draft_config_revision: number;
          draft_source_id: string;
          job_state: string;
          job_version_id: string;
          lease_owner: string | null;
          predecessor_version_id: string | null;
          presentation_alias: string | null;
          projection_sha256: string | null;
          preview_state: string | null;
          version_config_revision: number;
          version_source_id: string;
          version_state: string;
        }
      | undefined;
    if (!capture) throw new Error("PUBLICATION_CAPTURE_MISSING");
    if (!capture.projection_sha256) {
      throw new Error("PUBLICATION_PRESENTATION_MISSING");
    }
    if (
      capture.job_state !== "running" ||
      capture.lease_owner !== input.leaseOwner ||
      capture.job_version_id !== input.versionId
    ) {
      throw new Error("PUBLICATION_JOB_LEASE_INVALID");
    }
    if (
      capture.captured_source_id !== capture.draft_source_id ||
      capture.captured_config_revision !== capture.draft_config_revision ||
      capture.captured_current_version_id !== capture.current_version_id ||
      capture.version_source_id !== capture.captured_source_id ||
      capture.version_config_revision !== capture.captured_config_revision ||
      capture.predecessor_version_id !== capture.captured_current_version_id ||
      capture.version_state !== "ready" ||
      capture.preview_state !== "ready"
    ) {
      throw new SafeApplicationError(
        "PUBLICATION_STALE",
        "The completed build no longer matches the current draft.",
        409,
      );
    }
    if (capture.current_version_id) {
      const old = input.database
        .prepare(
          `UPDATE book_versions SET state = 'superseded'
           WHERE id = ? AND book_id = ? AND state = 'published'`,
        )
        .run(capture.current_version_id, capture.book_id);
      if (old.changes !== 1) throw new Error("PUBLICATION_OLD_STATE_INVALID");
    }
    const promoted = input.database
      .prepare(
        `UPDATE book_versions
         SET state = 'published', published_at = ?, verified_at = ?
         WHERE id = ? AND book_id = ? AND state = 'ready'`,
      )
      .run(input.nowMs, input.nowMs, input.versionId, capture.book_id);
    if (promoted.changes !== 1) {
      throw new Error("PUBLICATION_READY_STATE_INVALID");
    }
    const book = input.database
      .prepare(
        `UPDATE books
         SET current_version_id = ?, visibility = 'public',
             alias = ?, unavailable_reason = NULL, updated_at = ?
         WHERE id = ? AND draft_source_id = ?
           AND draft_config_revision = ?
           AND current_version_id IS ?
           AND deletion_requested_at IS NULL`,
      )
      .run(
        input.versionId,
        capture.presentation_alias,
        input.nowMs,
        capture.book_id,
        capture.captured_source_id,
        capture.captured_config_revision,
        capture.captured_current_version_id,
      );
    if (book.changes !== 1) throw new Error("PUBLICATION_BOOK_CAS_FAILED");
    input.database
      .prepare(
        `INSERT INTO audit_events (
          actor_user_id, action, book_id, version_id, job_id,
          safe_metadata_json, created_at
        ) VALUES (?, 'book.published', ?, ?, ?, ?, ?)`,
      )
      .run(
        input.actorUserId,
        capture.book_id,
        input.versionId,
        input.jobId,
        JSON.stringify({
          config_revision: capture.captured_config_revision,
          source_id: capture.captured_source_id,
        }),
        input.nowMs,
      );
    const completed = input.database
      .prepare(
        `UPDATE jobs
         SET state = 'succeeded', phase = 'complete',
             progress_json = ?, finished_at = ?,
             lease_owner = NULL, lease_until = NULL, heartbeat_at = NULL
         WHERE id = ? AND state = 'running' AND lease_owner = ?`,
      )
      .run(
        JSON.stringify({
          completed: 3,
          processed_bytes: null,
          total: 3,
          unit: "steps",
        }),
        input.nowMs,
        input.jobId,
        input.leaseOwner,
      );
    if (completed.changes !== 1) throw new Error("PUBLICATION_JOB_CAS_FAILED");
  });
  await injectCrashPoint(input.crashPoint, "after_current_pointer");
}
