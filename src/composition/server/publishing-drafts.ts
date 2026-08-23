import type Database from "better-sqlite3";

import { patchDraftConfig } from "@/modules/publishing/adapters/filesystem/config-revisions";
import {
  getDraftBlock,
  patchDraftBlock,
} from "@/modules/publishing/adapters/filesystem/draft-blocks";
import { DraftArtifactReader } from "@/modules/publishing/adapters/filesystem/draft-artifacts";
import { uploadDraftCover } from "@/modules/publishing/adapters/filesystem/draft-cover";
import { queueSourceReprocess } from "@/modules/publishing/adapters/filesystem/source-reprocess";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";

export function createPublishingDraftServer(database: Database.Database) {
  const drafts = new DraftRepository(database);
  const candidates = new DraftCandidateRepository(database);
  const sources = new SourceRepository(database);
  return Object.freeze({
    findBook: drafts.findBook.bind(drafts),
    findCurrentCandidate: candidates.findCurrent.bind(candidates),
    requireBook: drafts.requireBook.bind(drafts),
    requireConfig: drafts.requireConfig.bind(drafts),
    requireSource: sources.requireSnapshot.bind(sources),
  });
}

export function createPublishingArtifactServer(layout: StorageLayout) {
  return new DraftArtifactReader(layout);
}

export const publishingDraftActions = Object.freeze({
  getDraftBlock,
  patchDraftBlock,
  patchDraftConfig,
  queueSourceReprocess,
  uploadDraftCover,
});
