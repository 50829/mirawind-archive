import type { JobRecord } from "../db/repositories/jobs.js";

type SafeProgressValue = boolean | number | string | null;

function timestamp(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function safeProgress(
  progress: Readonly<Record<string, unknown>>,
): Readonly<Record<string, SafeProgressValue>> {
  const output: Record<string, SafeProgressValue> = {};
  for (const [key, value] of Object.entries(progress).slice(0, 100)) {
    if (
      key.length < 1 ||
      key.length > 80 ||
      !/^[a-zA-Z][a-zA-Z0-9_.-]*$/u.test(key)
    ) {
      continue;
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      output[key] = value;
    } else if (typeof value === "string") {
      output[key] = value.slice(0, 500);
    }
  }
  return Object.freeze(output);
}

export function serializeJobStatus(job: JobRecord) {
  return Object.freeze({
    attempt: job.attempt,
    automatic_retry_count: job.automaticRetryCount,
    created_at: new Date(job.createdAtMs).toISOString(),
    error_class: job.errorClass,
    error_code: job.errorCode,
    finished_at: timestamp(job.finishedAtMs),
    job_id: job.id,
    kind: job.kind,
    phase: job.phase.slice(0, 80),
    progress: safeProgress(job.progress),
    retry_of_job_id: job.retryOfJobId,
    started_at: timestamp(job.startedAtMs),
    state: job.state,
  });
}
