import { createOpaqueId } from "@/domain/ids";
import type { JobKind, JobState } from "../job-state";

export interface CandidateBuildAttempt {
  readonly bookId: number | null;
  readonly candidateId: string | null;
  readonly capturedSourceUpdatedAt: number | null;
  readonly capturedInputPath: string | null;
  readonly id: string;
  readonly kind: JobKind;
  readonly retryOfJobId: string | null;
  readonly state: JobState;
}

export interface CandidateBuildRetryCapture {
  readonly currentVersionId: string | null;
}

export interface CandidateBuildLifecyclePort {
  captureRetry(job: CandidateBuildAttempt): CandidateBuildRetryCapture;
  createRetry(input: {
    readonly candidateId: string;
    readonly jobId: string;
    readonly nowMs: number;
    readonly original: CandidateBuildAttempt;
  }): void;
  terminalize(input: {
    readonly candidateId: string;
    readonly jobId: string;
    readonly nowMs: number;
    readonly safeErrorCode: string;
    readonly state: "canceled" | "failed" | "interrupted";
  }): void;
}

interface CandidateBuildRetryTaskPort<Job extends CandidateBuildAttempt> {
  attachCandidate(jobId: string, candidateId: string): Job;
  findByIdempotency(operation: string, key: string): Job | null;
  retry(
    jobId: string,
    input: {
      readonly automatic: boolean;
      readonly idempotency?: {
        readonly key: string;
        readonly operation: string;
      };
      readonly nextAttempt: {
        readonly candidateId: null;
        readonly capturedCurrentVersionId: string | null;
        readonly versionId: string;
      };
      readonly nowMs: number;
    },
  ): Job;
}

export function terminalizeCandidateBuild(input: {
  readonly candidates: CandidateBuildLifecyclePort;
  readonly job: CandidateBuildAttempt;
  readonly nowMs: number;
  readonly safeErrorCode: string;
  readonly state: "canceled" | "failed" | "interrupted";
}): void {
  if (input.job.kind !== "build_candidate" || input.job.candidateId === null) {
    return;
  }
  input.candidates.terminalize({
    candidateId: input.job.candidateId,
    jobId: input.job.id,
    nowMs: input.nowMs,
    safeErrorCode: input.safeErrorCode,
    state: input.state,
  });
}

export function retryCandidateBuild<Job extends CandidateBuildAttempt>(input: {
  readonly automatic: boolean;
  readonly candidates: CandidateBuildLifecyclePort;
  readonly idempotency?: {
    readonly key: string;
    readonly operation: string;
  };
  readonly job: Job;
  readonly jobs: CandidateBuildRetryTaskPort<Job>;
  readonly nowMs: number;
  readonly runAtomically: <Result>(operation: () => Result) => Result;
}): Job {
  return input.runAtomically(() => {
    if (input.idempotency) {
      const existing = input.jobs.findByIdempotency(
        input.idempotency.operation,
        input.idempotency.key,
      );
      if (existing) {
        if (
          existing.retryOfJobId !== input.job.id ||
          existing.kind !== "build_candidate" ||
          existing.candidateId === null
        ) {
          throw new Error("IDEMPOTENCY_KEY_CONFLICT");
        }
        return existing;
      }
    }

    if (
      input.job.kind !== "build_candidate" ||
      input.job.bookId === null ||
      input.job.candidateId === null ||
      input.job.capturedInputPath === null ||
      input.job.capturedSourceUpdatedAt === null
    ) {
      throw new Error("CANDIDATE_RETRY_INPUT_INVALID");
    }

    const capture = input.candidates.captureRetry(input.job);
    const candidateId = createOpaqueId("draftCandidate");
    const retry = input.jobs.retry(input.job.id, {
      automatic: input.automatic,
      ...(input.idempotency ? { idempotency: input.idempotency } : {}),
      nextAttempt: {
        candidateId: null,
        capturedCurrentVersionId: capture.currentVersionId,
        versionId: createOpaqueId("version"),
      },
      nowMs: input.nowMs,
    });
    input.candidates.createRetry({
      candidateId,
      jobId: retry.id,
      nowMs: input.nowMs,
      original: input.job,
    });
    return input.jobs.attachCandidate(retry.id, candidateId);
  });
}
