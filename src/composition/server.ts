import type Database from "better-sqlite3";

import { acceptBookDeletion } from "@/modules/catalog/adapters/sqlite/book-deletion";
import { LibraryService } from "@/modules/catalog/adapters/sqlite/library";
import { deleteFinalPasskey } from "@/modules/identity/adapters/sqlite/final-passkey";
import { InstallationRepository } from "@/modules/identity/adapters/sqlite/installation";
import { patchDraftConfig } from "@/modules/publishing/adapters/filesystem/config-revisions";
import { DraftArtifactReader } from "@/modules/publishing/adapters/filesystem/draft-artifacts";
import { ImportUploadService } from "@/modules/publishing/adapters/filesystem/import-upload";
import { assertReadyPreviewIdentity } from "@/modules/publishing/adapters/filesystem/preview-identity";
import { queueSourceReprocess } from "@/modules/publishing/adapters/filesystem/source-reprocess";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { serializeJobStatus } from "@/modules/publishing/adapters/sqlite/job-status";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { makeBookNonPublic } from "@/modules/publishing/adapters/sqlite/publication";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { confirmImportCandidateAndQueuePreparation } from "@/modules/publishing/application/commands/confirm-import-candidate";
import { queuePublishBuild } from "@/modules/publishing/application/commands/queue-publish-build";
import type { StorageLayout } from "@/platform/filesystem/layout";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import { PublishedBookService } from "@/modules/reader/adapters/filesystem/published-book";
import { BookSearchRepository } from "@/modules/reader/adapters/sqlite/book-search";

export function createPublishingServer(database: Database.Database) {
  const drafts = new DraftRepository(database);
  const imports = new ImportRepository(database);
  const jobs = new JobRepository(database);
  const sources = new SourceRepository(database);
  return Object.freeze({
    cancelJob: jobs.requestCancellation.bind(jobs),
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
    findPreview: drafts.findPreview.bind(drafts),
    getJob: jobs.get.bind(jobs),
    importCandidates: imports.candidates.bind(imports),
    latestJobForImport: jobs.latestForImport.bind(jobs),
    listRecentJobs: jobs.listRecent.bind(jobs),
    requireBook: drafts.requireBook.bind(drafts),
    requireConfig: drafts.requireConfig.bind(drafts),
    requireImport: imports.require.bind(imports),
    requireSource: sources.requireSnapshot.bind(sources),
    queuePublishBuild: (input: {
      readonly bookId: number;
      readonly expectedRevision: number;
      readonly idempotencyKey: string;
      readonly nowMs: number;
    }) =>
      queuePublishBuild({
        ...input,
        drafts: {
          findPreview: drafts.findPreview.bind(drafts),
          requireBook: drafts.requireBook.bind(drafts),
        },
        jobs,
        runAtomically: (operation) =>
          withImmediateTransaction(database, operation),
      }),
    retryJob: jobs.retry.bind(jobs),
    storeImport: (layout: StorageLayout) =>
      new ImportUploadService(database, layout),
    serializeJobStatus: (
      job: NonNullable<ReturnType<JobRepository["get"]>>,
      includePublication = false,
    ) => serializeJobStatus(job, includePublication ? database : undefined),
  });
}

export function createPublishingArtifactServer(layout: StorageLayout) {
  return new DraftArtifactReader(layout);
}

export function createCatalogServer(database: Database.Database) {
  const library = new LibraryService(database);
  return Object.freeze({
    acceptBookDeletion: (
      input: Omit<Parameters<typeof acceptBookDeletion>[0], "database">,
    ) => acceptBookDeletion({ ...input, database }),
    administratorLibrary: library.administratorLibrary.bind(library),
    publicLibrary: library.publicLibrary.bind(library),
    resolveDetails: library.resolveDetails.bind(library),
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
  assertReadyPreviewIdentity,
  makeBookNonPublic,
  patchDraftConfig,
  queueSourceReprocess,
});
