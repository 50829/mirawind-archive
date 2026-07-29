import { resolve } from "node:path";

import type Database from "better-sqlite3";

import { BookDeletionRepository } from "@/db/repositories/book-deletions";
import type { DeletionSafeErrorCode } from "@/domain/book-deletion";
import { isOpaqueId } from "@/domain/ids";
import {
  removeExactContainedTree,
  UnsafePermanentRemovalTargetError,
} from "@/storage/permanent-removal";
import type { StorageLayout } from "@/storage/layout";

export interface PermanentBookCleanupResult {
  readonly removedStagingDirectories: number;
  readonly removedUploadDirectories: number;
}

function safeErrorCode(error: unknown): DeletionSafeErrorCode {
  if (error instanceof UnsafePermanentRemovalTargetError) return error.code;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "EACCES"
  ) {
    return "CLEANUP_FILESYSTEM_PERMISSION";
  }
  if (
    error instanceof Error &&
    error.message === "CLEANUP_DATABASE_INTEGRITY"
  ) {
    return "CLEANUP_DATABASE_INTEGRITY";
  }
  if (error instanceof Error && error.message === "CLEANUP_DATABASE_CONFLICT") {
    return "CLEANUP_DATABASE_CONFLICT";
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_")
  ) {
    return "CLEANUP_DATABASE_INTEGRITY";
  }
  return "CLEANUP_FILESYSTEM_IO";
}

function associatedIds(
  database: Database.Database,
  bookId: number,
): {
  readonly importIds: readonly string[];
  readonly jobIds: readonly string[];
} {
  const importIds = (
    database
      .prepare(
        `SELECT DISTINCT imports.id
         FROM imports
         LEFT JOIN source_snapshots
           ON source_snapshots.created_from_import_id = imports.id
         WHERE imports.book_id = ? OR source_snapshots.book_id = ?
         ORDER BY imports.id`,
      )
      .all(bookId, bookId) as { id: string }[]
  ).map((row) => row.id);
  if (importIds.some((id) => !isOpaqueId("import", id))) {
    throw new Error("CLEANUP_DATABASE_INTEGRITY");
  }
  const jobIds = (
    database
      .prepare(
        `SELECT DISTINCT jobs.id
         FROM jobs
         WHERE jobs.book_id = ?
            OR jobs.import_id IN (
              SELECT id FROM imports
              WHERE book_id = ?
                 OR id IN (
                   SELECT created_from_import_id
                   FROM source_snapshots WHERE book_id = ?
                 )
            )
            OR jobs.captured_source_id IN (
              SELECT id FROM source_snapshots WHERE book_id = ?
            )
            OR jobs.version_id IN (
              SELECT id FROM book_versions WHERE book_id = ?
            )
            OR jobs.captured_current_version_id IN (
              SELECT id FROM book_versions WHERE book_id = ?
            )
         ORDER BY jobs.id`,
      )
      .all(bookId, bookId, bookId, bookId, bookId, bookId) as { id: string }[]
  ).map((row) => row.id);
  if (jobIds.some((id) => !isOpaqueId("job", id))) {
    throw new Error("CLEANUP_DATABASE_INTEGRITY");
  }
  return {
    importIds: Object.freeze(importIds),
    jobIds: Object.freeze(jobIds),
  };
}

export async function permanentlyCleanupBook(input: {
  readonly bookId: number;
  readonly database: Database.Database;
  readonly jobId: string;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<PermanentBookCleanupResult> {
  const deletions = new BookDeletionRepository(input.database);
  const initial = deletions.requireByCleanupJobId(input.jobId);
  if (initial.state === "completed") {
    return Object.freeze({
      removedStagingDirectories: 0,
      removedUploadDirectories: 0,
    });
  }
  if (initial.bookId !== input.bookId) throw new Error("CLEANUP_INVALID_STATE");
  deletions.markPurging(input.jobId, input.nowMs);
  try {
    const ids = associatedIds(input.database, input.bookId);
    await removeExactContainedTree({
      root: input.layout.bookDirectory,
      target: resolve(input.layout.bookDirectory, String(input.bookId)),
    });
    for (const importId of ids.importIds) {
      await removeExactContainedTree({
        root: input.layout.uploadDirectory,
        target: resolve(input.layout.uploadDirectory, importId),
      });
    }
    const stagingRoot = resolve(input.layout.root, "staging");
    for (const jobId of ids.jobIds) {
      await removeExactContainedTree({
        root: stagingRoot,
        target: resolve(stagingRoot, jobId),
      });
    }
    deletions.completeContentPurge({
      bookId: input.bookId,
      cleanupJobId: input.jobId,
      nowMs: input.nowMs,
    });
    return Object.freeze({
      removedStagingDirectories: ids.jobIds.length,
      removedUploadDirectories: ids.importIds.length,
    });
  } catch (error) {
    const code = safeErrorCode(error);
    deletions.markFailed(input.jobId, code, input.nowMs);
    const safe = new Error(code);
    safe.cause = error;
    throw safe;
  }
}
