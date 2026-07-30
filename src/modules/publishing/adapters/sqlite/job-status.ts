import type { JobRecord } from "@/modules/publishing/adapters/sqlite/jobs";

function timestamp(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function serializeJobStatus(job: JobRecord) {
  const kind =
    job.kind === "purge_book"
      ? "permanent_book_deletion"
      : job.kind === "reclaim_versions"
        ? "reclaim"
        : job.kind;
  return Object.freeze({
    attempt: job.attempt,
    automatic_retry_count: job.automaticRetryCount,
    cancellation_requested_at: timestamp(job.cancellationRequestedAtMs),
    created_at: new Date(job.createdAtMs).toISOString(),
    error_class: job.errorClass,
    error_code: job.errorCode,
    finished_at: timestamp(job.finishedAtMs),
    job_id: job.id,
    kind,
    phase: job.phase.slice(0, 80),
    progress: job.progress,
    retry_of_job_id: job.retryOfJobId,
    started_at: timestamp(job.startedAtMs),
    state: job.state,
  });
}
