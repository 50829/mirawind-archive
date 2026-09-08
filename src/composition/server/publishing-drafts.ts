import type Database from "better-sqlite3";

import { queueDraftSave } from "@/modules/publishing/adapters/filesystem/queue-draft-save";
import {
  getDraftBlock,
  patchDraftBlock,
} from "@/modules/publishing/adapters/filesystem/draft-blocks";
import { DraftArtifactReader } from "@/modules/publishing/adapters/filesystem/draft-artifacts";
import { uploadDraftCover } from "@/modules/publishing/adapters/filesystem/draft-cover";
import { queueSourceReprocess } from "@/modules/publishing/adapters/filesystem/source-reprocess";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { DraftSaveRepository } from "@/modules/publishing/adapters/sqlite/draft-saves";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";

export function createPublishingDraftServer(database: Database.Database) {
  const drafts = new DraftRepository(database);
  const candidates = new DraftCandidateRepository(database);
  const saves = new DraftSaveRepository(database);
  return Object.freeze({
    findBook: drafts.findBook.bind(drafts),
    findCurrentCandidate: candidates.findCurrent.bind(candidates),
    findPreviewCandidate: candidates.findReadable.bind(candidates),
    requireBook: drafts.requireBook.bind(drafts),
    hasPendingSave: saves.pending.bind(saves),
  });
}

export function createPublishingArtifactServer(layout: StorageLayout) {
  return new DraftArtifactReader(layout);
}

export const publishingDraftActions = Object.freeze({
  getDraftBlock,
  patchDraftBlock,
  queueDraftSave,
  queueSourceReprocess,
  uploadDraftCover,
});
