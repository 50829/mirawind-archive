import { resolve } from "node:path";

import type { DeletionSafeErrorCode } from "@/domain/book-deletion";
import type { BookRemovalInventoryPort } from "../../application/catalog-api";
import {
  removeExactContainedTree,
  UnsafePermanentRemovalTargetError,
} from "@/platform/filesystem/permanent-removal";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";

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

export async function permanentlyCleanupBook(input: {
  readonly bookId: number;
  readonly layout: StorageLayout;
  readonly publishingCleanup: BookRemovalInventoryPort;
}): Promise<PermanentBookCleanupResult> {
  try {
    const ids = input.publishingCleanup.captureRemovalInventory(input.bookId);
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
    return Object.freeze({
      removedStagingDirectories: ids.jobIds.length,
      removedUploadDirectories: ids.importIds.length,
    });
  } catch (error) {
    const code = safeErrorCode(error);
    const safe = new Error(code);
    safe.cause = error;
    throw safe;
  }
}
