import type Database from "better-sqlite3";

import {
  reconcileBookVersionPresentations,
  type PresentationReconciliation,
} from "@/modules/catalog/adapters/filesystem/book-presentation";
import { reconcilePublishingStorage } from "@/modules/publishing/adapters/filesystem/storage-reconciliation";
import {
  verifyAndRecoverCurrentVersions,
  type CurrentVersionRecovery,
} from "@/composition/version-verification";
import type { StorageLayout } from "@/platform/filesystem/layout";

export interface StorageReconciliation {
  readonly corruptDatabaseVersions: readonly string[];
  readonly presentationReconciliation: PresentationReconciliation;
  readonly quarantinedDirectories: readonly string[];
  readonly recoveredCurrentVersions: readonly CurrentVersionRecovery[];
  readonly removedOrphanPaths: readonly string[];
  readonly removedStagingDirectories: readonly string[];
}

export async function reconcileStorage(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<StorageReconciliation> {
  const publishing = await reconcilePublishingStorage(input);
  const presentationReconciliation =
    await reconcileBookVersionPresentations(input);
  const recoveredCurrentVersions = await verifyAndRecoverCurrentVersions({
    ...input,
    presentationIntegrityFailures: [
      ...presentationReconciliation.failedVersionIds,
      ...presentationReconciliation.mismatchedVersionIds,
    ],
  });
  return Object.freeze({
    corruptDatabaseVersions: publishing.corruptDatabaseVersions,
    presentationReconciliation,
    quarantinedDirectories: publishing.quarantinedDirectories,
    recoveredCurrentVersions,
    removedOrphanPaths: publishing.removedOrphanPaths,
    removedStagingDirectories: publishing.removedStagingDirectories,
  });
}
