import { resolveContainedPath } from "@/platform/filesystem/layout";
import { removeExactContainedTree } from "@/platform/filesystem/permanent-removal";
import type {
  ExpiredJobLeaseRepository,
  RecoverableJob,
} from "@/modules/publishing/application/ports/expired-job-leases";
import { evaluateJobRetry } from "@/modules/publishing/application/retry-policy";

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
  readonly repository: ExpiredJobLeaseRepository<Job>;
  readonly storageRoot: string;
}): Promise<readonly InterruptedJobRecovery<Job>[]> {
  const newlyInterrupted = input.repository.interruptExpired({
    nowMs: input.nowMs,
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
        retry: decision.allowed
          ? input.repository.retry(job.id, {
              automatic: true,
              nowMs: input.nowMs,
            })
          : null,
      }),
    );
  }
  return Object.freeze(recovered);
}
