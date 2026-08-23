import type Database from "better-sqlite3";

import {
  cancelBookDeletion,
  retryBookDeletion,
} from "@/composition/book-deletion";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import {
  serializeJobStatus,
  type JobSubject,
} from "@/modules/publishing/adapters/sqlite/job-status";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import {
  retryCandidateBuild,
  terminalizeCandidateBuild,
} from "@/modules/publishing/application/commands/maintain-candidate-build";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export function createPublishingJobServer(database: Database.Database) {
  const drafts = new DraftRepository(database);
  const candidates = new DraftCandidateRepository(database);
  const imports = new ImportRepository(database);
  const jobs = new JobRepository(database);
  const jobSubject = (
    job: NonNullable<ReturnType<JobRepository["get"]>>,
  ): JobSubject => {
    const book = job.bookId === null ? null : drafts.findBook(job.bookId);
    if (book) return Object.freeze({ kind: "book", label: book.title });
    const imported = job.importId === null ? null : imports.find(job.importId);
    if (imported) {
      return Object.freeze({ kind: "import", label: imported.originalName });
    }
    return Object.freeze({ kind: "system", label: "系统维护" });
  };
  return Object.freeze({
    cancelJob: (jobId: string, nowMs: number) => {
      const job = jobs.get(jobId);
      if (job?.kind === "purge_book") {
        return cancelBookDeletion(database, job, nowMs);
      }
      if (job?.kind !== "build_candidate") {
        return jobs.requestCancellation(jobId, nowMs);
      }
      return withImmediateTransaction(database, () => {
        const canceled = jobs.requestCancellation(jobId, nowMs);
        if (canceled.state === "canceled") {
          terminalizeCandidateBuild({
            candidates,
            job: canceled,
            nowMs,
            safeErrorCode: "JOB_CANCELED",
            state: "canceled",
          });
        }
        return canceled;
      });
    },
    getJob: jobs.get.bind(jobs),
    listRecentJobs: jobs.listRecent.bind(jobs),
    retryJob: (
      jobId: string,
      input: {
        readonly automatic: boolean;
        readonly idempotency?: {
          readonly key: string;
          readonly operation: string;
        };
        readonly nowMs: number;
      },
    ) => {
      const job = jobs.get(jobId);
      if (job?.kind === "purge_book") {
        return retryBookDeletion({ ...input, database, jobId });
      }
      if (job?.kind === "build_candidate") {
        return retryCandidateBuild({
          ...input,
          candidates,
          job,
          jobs,
          runAtomically: (operation) =>
            withImmediateTransaction(database, operation),
        });
      }
      return jobs.retry(jobId, input);
    },
    serializeJobStatus: (job: NonNullable<ReturnType<JobRepository["get"]>>) =>
      serializeJobStatus(job, jobSubject(job)),
  });
}
