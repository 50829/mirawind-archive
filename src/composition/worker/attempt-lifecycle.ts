import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type Database from "better-sqlite3";

import {
  completeBookDeletionFailure,
  completeBookDeletionInterruption,
  recordExpiredBookDeletion,
  retryBookDeletion,
} from "../book-deletion";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import {
  JobRepository,
  type JobErrorClass,
  type JobRecord,
} from "@/modules/publishing/adapters/sqlite/jobs";
import {
  retryCandidateBuild,
  terminalizeCandidateBuild,
} from "@/modules/publishing/application/commands/maintain-candidate-build";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { resolveContainedPath } from "@/platform/filesystem/contained-path";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export async function cancelImportJob(input: {
  readonly imports: ImportRepository;
  readonly job: JobRecord;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<void> {
  if (
    !input.job.importId ||
    (input.job.kind !== "analyze_import" && input.job.kind !== "prepare_draft")
  ) {
    return;
  }
  const imported = input.imports.require(input.job.importId);
  if (
    ["uploaded", "analyzing", "needs_main_confirmation", "preparing"].includes(
      imported.state,
    )
  ) {
    input.imports.cancel(imported.id, input.nowMs);
  }
  await rm(resolve(input.layout.root, "staging", input.job.id), {
    force: true,
    recursive: true,
  });
  if (input.job.kind === "analyze_import") {
    const archivePath = await resolveContainedPath(
      input.layout.root,
      imported.uploadRelativePath,
    );
    await rm(resolve(dirname(archivePath), "sealed-extraction"), {
      force: true,
      recursive: true,
    });
  }
}

export function completeJobFailure(input: {
  readonly candidates: DraftCandidateRepository;
  readonly database: Database.Database;
  readonly errorClass: JobErrorClass;
  readonly errorCode: string;
  readonly job: JobRecord;
  readonly leaseOwner: string;
  readonly nowMs: number;
  readonly repository: JobRepository;
}): JobRecord {
  if (input.job.kind === "purge_book")
    return completeBookDeletionFailure(input);
  if (input.job.kind !== "build_candidate") {
    return input.repository.completeFailure({
      errorClass: input.errorClass,
      errorCode: input.errorCode,
      jobId: input.job.id,
      leaseOwner: input.leaseOwner,
      nowMs: input.nowMs,
    });
  }
  return withImmediateTransaction(input.database, () => {
    const completed = input.repository.completeFailure({
      errorClass: input.errorClass,
      errorCode: input.errorCode,
      jobId: input.job.id,
      leaseOwner: input.leaseOwner,
      nowMs: input.nowMs,
    });
    terminalizeCandidateBuild({
      candidates: input.candidates,
      job: completed,
      nowMs: input.nowMs,
      safeErrorCode: input.errorCode,
      state: completed.state === "canceled" ? "canceled" : "failed",
    });
    return completed;
  });
}

export function completeJobInterruption(input: {
  readonly candidates: DraftCandidateRepository;
  readonly database: Database.Database;
  readonly errorCode: string;
  readonly job: JobRecord;
  readonly leaseOwner: string;
  readonly nowMs: number;
  readonly repository: JobRepository;
}): JobRecord {
  if (input.job.kind === "purge_book") {
    return completeBookDeletionInterruption(input);
  }
  if (input.job.kind !== "build_candidate") {
    return input.repository.completeInterruption({
      errorCode: input.errorCode,
      jobId: input.job.id,
      leaseOwner: input.leaseOwner,
      nowMs: input.nowMs,
    });
  }
  return withImmediateTransaction(input.database, () => {
    const completed = input.repository.completeInterruption({
      errorCode: input.errorCode,
      jobId: input.job.id,
      leaseOwner: input.leaseOwner,
      nowMs: input.nowMs,
    });
    terminalizeCandidateBuild({
      candidates: input.candidates,
      job: completed,
      nowMs: input.nowMs,
      safeErrorCode: input.errorCode,
      state: "interrupted",
    });
    return completed;
  });
}

export function recordExpiredJobLifecycle(input: {
  readonly candidates: DraftCandidateRepository;
  readonly database: Database.Database;
  readonly job: JobRecord;
  readonly nowMs: number;
}): void {
  recordExpiredBookDeletion(input.database, input.job, input.nowMs);
  terminalizeCandidateBuild({
    candidates: input.candidates,
    job: input.job,
    nowMs: input.nowMs,
    safeErrorCode: "JOB_LEASE_EXPIRED",
    state: "interrupted",
  });
}

export function retryJobAttempt(input: {
  readonly automatic: boolean;
  readonly candidates: DraftCandidateRepository;
  readonly database: Database.Database;
  readonly job: JobRecord;
  readonly jobs: JobRepository;
  readonly nowMs: number;
}): JobRecord {
  if (input.job.kind === "purge_book") {
    return retryBookDeletion({
      automatic: input.automatic,
      database: input.database,
      jobId: input.job.id,
      nowMs: input.nowMs,
    });
  }
  if (input.job.kind === "build_candidate") {
    return retryCandidateBuild({
      automatic: input.automatic,
      candidates: input.candidates,
      job: input.job,
      jobs: input.jobs,
      nowMs: input.nowMs,
      runAtomically: (operation) =>
        withImmediateTransaction(input.database, operation),
    });
  }
  return input.jobs.retry(input.job.id, {
    automatic: input.automatic,
    nowMs: input.nowMs,
  });
}
