import type { JobRecord } from "@/modules/publishing/adapters/sqlite/jobs";
import type Database from "better-sqlite3";

function timestamp(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function serializeJobStatus(
  job: JobRecord,
  database?: Database.Database,
) {
  const isDeletionCleanup =
    database !== undefined &&
    database
      .prepare(
        `SELECT 1 FROM book_deletions
         WHERE cleanup_job_id = ?`,
      )
      .get(job.id) !== undefined;
  return Object.freeze({
    attempt: job.attempt,
    automatic_retry_count: job.automaticRetryCount,
    cancellation_requested_at: timestamp(job.cancellationRequestedAtMs),
    created_at: new Date(job.createdAtMs).toISOString(),
    error_class: job.errorClass,
    error_code: job.errorCode,
    finished_at: timestamp(job.finishedAtMs),
    job_id: job.id,
    kind: isDeletionCleanup ? "permanent_book_deletion" : job.kind,
    phase: job.phase.slice(0, 80),
    progress: job.progress,
    retry_of_job_id: job.retryOfJobId,
    started_at: timestamp(job.startedAtMs),
    state: job.state,
  });
}
