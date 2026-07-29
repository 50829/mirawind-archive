import { chmod, lstat, rm } from "node:fs/promises";

import { resolveContainedPath } from "@/platform/filesystem/layout";
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
  const metadata = await lstat(path).catch((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  });
  if (metadata?.isDirectory() && !metadata.isSymbolicLink()) {
    await chmod(path, 0o700);
  }
  await rm(path, { force: true, recursive: true });
}

export async function recoverExpiredJobLeases<
  Job extends RecoverableJob,
>(input: {
  readonly nowMs: number;
  readonly repository: ExpiredJobLeaseRepository<Job>;
  readonly storageRoot: string;
}): Promise<readonly InterruptedJobRecovery<Job>[]> {
  const interrupted = input.repository.interruptExpired({
    nowMs: input.nowMs,
  });
  const recovered: InterruptedJobRecovery<Job>[] = [];
  for (const job of interrupted) {
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
