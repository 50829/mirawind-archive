import { join } from "node:path";

import type { PurgeBookCommand } from "@/entrypoints/worker/protocol";
import { permanentlyCleanupBook } from "@/modules/catalog/adapters/filesystem/permanent-book-cleanup";
import { SqliteBookPublishingCleanup } from "@/modules/publishing/adapters/sqlite/book-cleanup";
import { createStorageLayout } from "@/platform/filesystem/storage-layout";
import { openDatabase } from "@/platform/sqlite/connection";
import {
  stepProgress,
  type WorkerChildContext,
  type WorkerChildOutcome,
} from "../job-handler";

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
