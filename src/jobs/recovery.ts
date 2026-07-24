import { chmod, lstat, rm } from "node:fs/promises";

import type { JobRecord, JobRepository } from "../db/repositories/jobs.js";
import { resolveContainedPath } from "../storage/layout.js";
import { evaluateJobRetry } from "./retry-policy.js";

export interface InterruptedJobRecovery {
  readonly interrupted: JobRecord;
  readonly retry: JobRecord | null;
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

export async function recoverExpiredJobLeases(input: {
  readonly nowMs: number;
  readonly repository: JobRepository;
  readonly storageRoot: string;
}): Promise<readonly InterruptedJobRecovery[]> {
  const interrupted = input.repository.interruptExpired({
    nowMs: input.nowMs,
  });
  const recovered: InterruptedJobRecovery[] = [];
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
