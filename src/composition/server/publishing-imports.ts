import type Database from "better-sqlite3";

import { ImportUploadService } from "@/modules/publishing/adapters/filesystem/import-upload";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { confirmImportCandidateAndQueuePreparation } from "@/modules/publishing/application/commands/confirm-import-candidate";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export function createPublishingImportServer(database: Database.Database) {
  const imports = new ImportRepository(database);
  const jobs = new JobRepository(database);
  return Object.freeze({
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
    findImport: imports.find.bind(imports),
    findJobByIdempotency: jobs.findByIdempotency.bind(jobs),
    importCandidates: imports.candidates.bind(imports),
    latestJobForImport: jobs.latestForImport.bind(jobs),
    requireImport: imports.require.bind(imports),
    storeImport: (layout: StorageLayout) =>
      new ImportUploadService(database, layout),
  });
}
