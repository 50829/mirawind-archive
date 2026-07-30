import type { RetryableJob } from "@/modules/publishing/application/retry-policy";

export interface RecoverableJob extends RetryableJob {
  readonly id: string;
}

export interface ExpiredJobLeaseRepository<
  Job extends RecoverableJob = RecoverableJob,
> {
  interruptExpired(input: {
    readonly nowMs: number;
    readonly onInterrupted?: (job: Job) => void;
  }): readonly Job[];
  listPendingAutomaticRetries(): readonly Job[];
}
