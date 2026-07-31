import type { JobRecord } from "@/modules/publishing/adapters/sqlite/jobs";

export interface JobSubject {
  readonly kind: "book" | "import" | "system";
  readonly label: string;
}

function timestamp(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function serializeJobStatus(job: JobRecord, subject: JobSubject) {
  const kind =
    job.kind === "purge_book"
      ? "permanent_book_deletion"
      : job.kind === "reclaim_versions"
        ? "reclaim"
        : job.kind;
  const progress =
    job.state === "succeeded" && job.progress.total !== null
      ? Object.freeze({
          ...job.progress,
          completed: job.progress.total,
        })
      : job.progress;
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
    progress,
    retry_of_job_id: job.retryOfJobId,
    started_at: timestamp(job.startedAtMs),
    state: job.state,
    subject,
  });
}
