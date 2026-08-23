import { resolveContainedPath } from "@/platform/filesystem/contained-path";
import { removeExactContainedTree } from "@/platform/filesystem/permanent-removal";
import type {
  ExpiredJobLeaseRepository,
  RecoverableJob,
} from "./ports/expired-job-leases";
import { evaluateJobRetry } from "./retry-policy";

export interface InterruptedJobRecovery<Job extends RecoverableJob> {
  readonly interrupted: Job;
  readonly retry: Job | null;
}

async function removeJobStaging(
  storageRoot: string,
  jobId: string,
): Promise<void> {
  const path = await resolveContainedPath(storageRoot, `staging/${jobId}`);
  await removeExactContainedTree({ root: storageRoot, target: path });
}

export async function recoverExpiredJobLeases<
  Job extends RecoverableJob,
>(input: {
  readonly nowMs: number;
  readonly onInterrupted?: (job: Job) => void;
  readonly repository: ExpiredJobLeaseRepository<Job>;
  readonly retryJob: (job: Job, nowMs: number) => Job;
  readonly storageRoot: string;
}): Promise<readonly InterruptedJobRecovery<Job>[]> {
  const newlyInterrupted = input.repository.interruptExpired({
    nowMs: input.nowMs,
    ...(input.onInterrupted ? { onInterrupted: input.onInterrupted } : {}),
  });
  const interrupted = new Map(
    newlyInterrupted.map((job) => [job.id, job] as const),
  );
  for (const job of input.repository.listPendingAutomaticRetries()) {
    interrupted.set(job.id, job);
  }
  const recovered: InterruptedJobRecovery<Job>[] = [];
  for (const job of interrupted.values()) {
    await removeJobStaging(input.storageRoot, job.id);
    const decision = evaluateJobRetry(job, "automatic");
    recovered.push(
      Object.freeze({
        interrupted: job,
        retry: decision.allowed ? input.retryJob(job, input.nowMs) : null,
      }),
    );
  }
  return Object.freeze(recovered);
}
