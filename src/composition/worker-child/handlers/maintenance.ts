import { join } from "node:path";

import { reconcileStorage } from "../../storage-reconciliation";
import { verifyVersion } from "../../verify-version-job";
import type {
  PurgeBookCommand,
  ReclaimVersionsCommand,
  ReconcileCommand,
  VerifyVersionCommand,
} from "@/entrypoints/worker/protocol";
import { permanentlyCleanupBook } from "@/modules/catalog/adapters/filesystem/permanent-book-cleanup";
import { BookPresentationRepository } from "@/modules/catalog/adapters/sqlite/book-presentations";
import { SqliteBookPublishingCleanup } from "@/modules/publishing/adapters/sqlite/book-cleanup";
import { reclaimRetainedStorage } from "@/modules/publishing/adapters/worker/reclaim";
import { createStorageLayout } from "@/platform/filesystem/storage-layout";
import { openDatabase } from "@/platform/sqlite/connection";
import {
  stepProgress,
  type WorkerChildContext,
  type WorkerChildOutcome,
} from "../job-handler";

export async function verifyVersionHandler(
  command: VerifyVersionCommand,
  context: WorkerChildContext,
): Promise<WorkerChildOutcome> {
  context.reportProgress("verify_manifest", stepProgress(0, 1));
  const database = openDatabase(join(context.root, "db", "mirawind.sqlite"), {
    role: "worker",
  });
  try {
    const outcome = await verifyVersion({
      database,
      layout: await createStorageLayout(context.root),
      nowMs: Date.now(),
      versionId: command.versionId,
    });
    return outcome.result.ok
      ? Object.freeze({
          ok: true,
          result: Object.freeze({
            recovered: outcome.recovery !== null,
            version_id: outcome.versionId,
          }),
        })
      : Object.freeze({
          ok: false,
          safeErrorClass: "content",
          safeErrorCode: outcome.result.code,
        });
  } finally {
    database.close();
  }
}

export async function reconcileHandler(
  _command: ReconcileCommand,
  context: WorkerChildContext,
): Promise<WorkerChildOutcome> {
  context.reportProgress("reconcile_storage", stepProgress(0, 1));
  const database = openDatabase(join(context.root, "db", "mirawind.sqlite"), {
    role: "worker",
  });
  try {
    const outcome = await reconcileStorage({
      database,
      layout: await createStorageLayout(context.root),
      nowMs: Date.now(),
    });
    return Object.freeze({
      ok: true,
      result: Object.freeze({
        corrupt_versions: outcome.corruptDatabaseVersions.length,
        quarantined: outcome.quarantinedDirectories.length,
        recovered_current: outcome.recoveredCurrentVersions.length,
        removed_orphans: outcome.removedOrphanPaths.length,
        removed_staging: outcome.removedStagingDirectories.length,
      }),
    });
  } finally {
    database.close();
  }
}

export async function reclaimVersionsHandler(
  _command: ReclaimVersionsCommand,
  context: WorkerChildContext,
): Promise<WorkerChildOutcome> {
  context.reportProgress("reclaim_storage", stepProgress(0, 1));
  const database = openDatabase(join(context.root, "db", "mirawind.sqlite"), {
    role: "worker",
  });
  try {
    const outcome = await reclaimRetainedStorage({
      database,
      layout: await createStorageLayout(context.root),
      nowMs: Date.now(),
      presentationRemover: new BookPresentationRepository(database),
    });
    return outcome.failedPaths.length === 0
      ? Object.freeze({
          ok: true,
          result: Object.freeze({
            reclaimed_versions: outcome.reclaimedVersionIds.length,
            removed_quarantine: outcome.removedQuarantinePaths.length,
          }),
        })
      : Object.freeze({
          ok: false,
          safeErrorClass: "infrastructure",
          safeErrorCode: "RECLAIM_CLEANUP_INCOMPLETE",
        });
  } finally {
    database.close();
  }
}

export async function purgeBookHandler(
  command: PurgeBookCommand,
  context: WorkerChildContext,
): Promise<WorkerChildOutcome> {
  context.reportProgress("permanent_book_deletion", stepProgress(0, 1));
  const database = openDatabase(join(context.root, "db", "mirawind.sqlite"), {
    role: "worker",
  });
  try {
    const outcome = await permanentlyCleanupBook({
      bookId: command.bookId,
      layout: await createStorageLayout(context.root),
      publishingCleanup: new SqliteBookPublishingCleanup(database),
    });
    return Object.freeze({
      ok: true,
      result: Object.freeze({
        removed_staging: outcome.removedStagingDirectories,
        removed_uploads: outcome.removedUploadDirectories,
      }),
    });
  } finally {
    database.close();
  }
}
