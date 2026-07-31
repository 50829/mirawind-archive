import type Database from "better-sqlite3";

import {
  cancelBookDeletion,
  retryBookDeletion,
} from "@/composition/book-deletion";

import { acceptBookDeletion } from "@/modules/catalog/adapters/sqlite/book-deletion";
import { SqliteBookAccessRepository } from "@/modules/catalog/adapters/sqlite/book-access";
import { LibraryService } from "@/modules/catalog/adapters/sqlite/library";
import { setBookAccess } from "@/modules/catalog/application/commands/set-book-access";
import { deleteFinalPasskey } from "@/modules/identity/adapters/sqlite/final-passkey";
import { InstallationRepository } from "@/modules/identity/adapters/sqlite/installation";
import { patchDraftConfig } from "@/modules/publishing/adapters/filesystem/config-revisions";
import {
  getDraftBlock,
  patchDraftBlock,
} from "@/modules/publishing/adapters/filesystem/draft-blocks";
import { DraftArtifactReader } from "@/modules/publishing/adapters/filesystem/draft-artifacts";
import { ImportUploadService } from "@/modules/publishing/adapters/filesystem/import-upload";
import { queueSourceReprocess } from "@/modules/publishing/adapters/filesystem/source-reprocess";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { CandidatePublicationRepository } from "@/modules/publishing/adapters/sqlite/candidate-publication";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import {
  serializeJobStatus,
  type JobSubject,
} from "@/modules/publishing/adapters/sqlite/job-status";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { SqliteBookPublishingCleanup } from "@/modules/publishing/adapters/sqlite/book-cleanup";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { confirmImportCandidateAndQueuePreparation } from "@/modules/publishing/application/commands/confirm-import-candidate";
import {
  retryCandidateBuild,
  terminalizeCandidateBuild,
} from "@/modules/publishing/application/commands/maintain-candidate-build";
import {
  m1PublishPolicy,
  publishCandidate,
} from "@/modules/publishing/application/public";
import type { StorageLayout } from "@/platform/filesystem/layout";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import { PublishedBookService } from "@/modules/reader/adapters/filesystem/published-book";
import { BookSearchRepository } from "@/modules/reader/adapters/sqlite/book-search";

export function createPublishingServer(database: Database.Database) {
  const drafts = new DraftRepository(database);
  const candidates = new DraftCandidateRepository(database);
  const imports = new ImportRepository(database);
  const jobs = new JobRepository(database);
  const sources = new SourceRepository(database);
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
    confirmImportCandidateAndQueuePreparation: (input: {
      readonly candidateId: string;
      readonly importId: string;
      readonly nowMs: number;
    }) =>
      confirmImportCandidateAndQueuePreparation({
        ...input,
        imports: {
          candidates: imports.candidates.bind(imports),
          confirmCandidate: imports.confirmCandidate.bind(imports),
          find: imports.find.bind(imports),
        },
        jobs,
        runAtomically: (operation) =>
          withImmediateTransaction(database, operation),
      }),
    findBook: drafts.findBook.bind(drafts),
    findImport: imports.find.bind(imports),
    findJobByIdempotency: jobs.findByIdempotency.bind(jobs),
    findCurrentCandidate: candidates.findCurrent.bind(candidates),
    getJob: jobs.get.bind(jobs),
    importCandidates: imports.candidates.bind(imports),
    latestJobForImport: jobs.latestForImport.bind(jobs),
    listRecentJobs: jobs.listRecent.bind(jobs),
    requireBook: drafts.requireBook.bind(drafts),
    requireConfig: drafts.requireConfig.bind(drafts),
    requireImport: imports.require.bind(imports),
    requireSource: sources.requireSnapshot.bind(sources),
    publishCandidate: (input: {
      readonly actorUserId: string | null;
      readonly bookId: number;
      readonly expectedConfigEtag: string;
      readonly nowMs: number;
    }) =>
      publishCandidate({
        ...input,
        policy: m1PublishPolicy,
        publication: new CandidatePublicationRepository(database),
      }),
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
        return retryBookDeletion({
          ...input,
          database,
          jobId,
        });
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
    storeImport: (layout: StorageLayout) =>
      new ImportUploadService(database, layout),
    serializeJobStatus: (job: NonNullable<ReturnType<JobRepository["get"]>>) =>
      serializeJobStatus(job, jobSubject(job)),
  });
}

export function createPublishingArtifactServer(layout: StorageLayout) {
  return new DraftArtifactReader(layout);
}

export function createCatalogServer(database: Database.Database) {
  const library = new LibraryService(database);
  const bookAccess = new SqliteBookAccessRepository(database);
  return Object.freeze({
    acceptBookDeletion: (
      input: Omit<
        Parameters<typeof acceptBookDeletion>[0],
        "database" | "deletionTasks" | "publishingCleanup"
      >,
    ) => {
      const publishingCleanup = new SqliteBookPublishingCleanup(database);
      return acceptBookDeletion({
        ...input,
        database,
        deletionTasks: publishingCleanup,
        publishingCleanup,
      });
    },
    administratorLibrary: library.administratorLibrary.bind(library),
    publicLibrary: library.publicLibrary.bind(library),
    resolveDetails: library.resolveDetails.bind(library),
    setBookAccess: (
      input: Omit<Parameters<typeof setBookAccess>[0], "books">,
    ) => setBookAccess({ ...input, books: bookAccess }),
  });
}

export function createReaderServer(database: Database.Database) {
  const search = new BookSearchRepository(database);
  return Object.freeze({ search: search.search.bind(search) });
}

export function createPublishedBookServer(
  database: Database.Database,
  layout: StorageLayout,
) {
  return new PublishedBookService(database, layout);
}

export function createIdentityServer(database: Database.Database) {
  const installation = new InstallationRepository(database);
  return Object.freeze({
    adminUserId: installation.adminUserId.bind(installation),
    deleteFinalPasskey: (
      input: Omit<Parameters<typeof deleteFinalPasskey>[0], "database">,
    ) => deleteFinalPasskey({ ...input, database }),
  });
}

export const publishingServerActions = Object.freeze({
  getDraftBlock,
  patchDraftBlock,
  patchDraftConfig,
  queueSourceReprocess,
});
