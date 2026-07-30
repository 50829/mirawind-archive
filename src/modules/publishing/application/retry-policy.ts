import {
  isTerminalJobState,
  type JobKind,
  type JobState,
} from "@/modules/publishing/application/job-state";

export interface RetryableJob {
  readonly automaticRetryCount: number;
  readonly errorClass: string | null;
  readonly errorCode: string | null;
  readonly kind: JobKind;
  readonly state: JobState;
  readonly versionId: string | null;
}

export type JobRetryMode = "automatic" | "manual";

export type JobRetryDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      reason:
        | "AUTOMATIC_RETRY_NOT_INFRASTRUCTURE_INTERRUPTION"
        | "AUTOMATIC_RETRY_LIMIT_REACHED"
        | "JOB_NOT_RETRYABLE"
        | "READY_PUBLICATION_REQUIRES_PUBLISH_ACTION";
    }>;

const manualRetryClasses = new Set([
  "canceled",
  "content",
  "infrastructure",
  "security_limit",
  "timeout",
  "validation",
]);

export function evaluateJobRetry(
  job: RetryableJob,
  mode: JobRetryMode,
): JobRetryDecision {
  if (!isTerminalJobState(job.state) || job.state === "succeeded") {
    return { allowed: false, reason: "JOB_NOT_RETRYABLE" };
  }

  if (job.kind === "build_candidate" && job.versionId !== null) {
    return {
      allowed: false,
      reason: "READY_PUBLICATION_REQUIRES_PUBLISH_ACTION",
    };
  }

  if (mode === "automatic") {
    if (job.automaticRetryCount >= 1) {
      return {
        allowed: false,
        reason: "AUTOMATIC_RETRY_LIMIT_REACHED",
      };
    }
    if (
      job.state !== "interrupted" ||
      job.errorClass !== "infrastructure" ||
      job.errorCode !== "JOB_LEASE_EXPIRED"
    ) {
      return {
        allowed: false,
        reason: "AUTOMATIC_RETRY_NOT_INFRASTRUCTURE_INTERRUPTION",
      };
    }
    return { allowed: true };
  }

  return job.errorClass && manualRetryClasses.has(job.errorClass)
    ? { allowed: true }
    : { allowed: false, reason: "JOB_NOT_RETRYABLE" };
}
