import { chmod, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";

import { VersionRepository } from "@/db/repositories/versions";
import { isOpaqueId } from "@/domain/ids";
import {
  reconcileBookVersionPresentations,
  type PresentationReconciliation,
} from "@/services/book-presentation";
import {
  verifyAndRecoverCurrentVersions,
  type CurrentVersionRecovery,
} from "@/services/version-verifier";
import type { StorageLayout } from "@/storage/layout";

export interface StorageReconciliation {
  readonly corruptDatabaseVersions: readonly string[];
  readonly presentationReconciliation: PresentationReconciliation;
  readonly quarantinedDirectories: readonly string[];
  readonly recoveredCurrentVersions: readonly CurrentVersionRecovery[];
  readonly removedStagingDirectories: readonly string[];
}

async function existsAsDirectory(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return !metadata.isSymbolicLink() && metadata.isDirectory();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function removeTree(path: string): Promise<void> {
  const metadata = await lstat(path).catch((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  });
  if (metadata?.isDirectory() && !metadata.isSymbolicLink()) {
    await chmod(path, 0o700);
  }
  await rm(path, { force: true, recursive: true });
}

async function reconcileStaging(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<readonly string[]> {
  const stagingRoot = resolve(input.layout.root, "staging");
  await mkdir(stagingRoot, { mode: 0o700, recursive: true });
  const entries = await readdir(stagingRoot, { withFileTypes: true });
  const removed: string[] = [];
  for (const entry of entries) {
    const path = resolve(stagingRoot, entry.name);
    const active =
      isOpaqueId("job", entry.name) &&
      input.database
        .prepare(
          `SELECT 1 FROM jobs
           WHERE id = ? AND state = 'running' AND lease_until >= ?`,
        )
        .get(entry.name, input.nowMs) !== undefined;
    if (active && entry.isDirectory() && !entry.isSymbolicLink()) continue;
    await removeTree(path);
    removed.push(entry.name);
  }
  return Object.freeze(removed.sort());
}

async function quarantineOrphanVersions(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<readonly string[]> {
  const known = new Set(
    new VersionRepository(input.database)
      .listAll()
      .map((version) => version.versionRelativePath),
  );
  const quarantined: string[] = [];
  const books = await readdir(input.layout.bookDirectory, {
    withFileTypes: true,
  });
  for (const book of books) {
    if (
      !book.isDirectory() ||
      book.isSymbolicLink() ||
      !/^[1-9][0-9]*$/u.test(book.name)
    ) {
      continue;
    }
    const versionsDirectory = resolve(
      input.layout.bookDirectory,
      book.name,
      "versions",
    );
    if (!(await existsAsDirectory(versionsDirectory))) continue;
    const entries = await readdir(versionsDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = `books/${book.name}/versions/${entry.name}`;
      if (
        known.has(relativePath) &&
        entry.isDirectory() &&
        !entry.isSymbolicLink()
      ) {
        continue;
      }
      const quarantineDirectory = resolve(
        input.layout.bookDirectory,
        book.name,
        "quarantine",
      );
      await chmod(resolve(input.layout.bookDirectory, book.name), 0o700);
      await chmod(versionsDirectory, 0o700);
      await mkdir(quarantineDirectory, { mode: 0o700, recursive: true });
      const targetName = `${entry.name}.${input.nowMs}`;
      const source = resolve(versionsDirectory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await chmod(source, 0o700);
      }
      await rename(source, resolve(quarantineDirectory, targetName));
      quarantined.push(`books/${book.name}/quarantine/${targetName}`);
    }
  }
  return Object.freeze(quarantined.sort());
}

async function markMissingDatabaseVersions(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly repository: VersionRepository;
}): Promise<readonly string[]> {
  const corrupt: string[] = [];
  for (const version of input.repository.listAll()) {
    if (version.reclaimedAtMs !== null) continue;
    const active = input.database
      .prepare(
        `SELECT 1 FROM books
         WHERE id = ? AND deletion_requested_at IS NULL`,
      )
      .get(version.bookId);
    if (!active) continue;
    const expected = `books/${version.bookId}/versions/${version.id}`;
    if (
      version.versionRelativePath !== expected ||
      !(await existsAsDirectory(resolve(input.layout.root, expected)))
    ) {
      input.repository.markCorrupt(version.id);
      corrupt.push(version.id);
    }
  }
  return Object.freeze(corrupt);
}

export async function reconcileStorage(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<StorageReconciliation> {
  const removedStagingDirectories = await reconcileStaging(input);
  const quarantinedDirectories = await quarantineOrphanVersions(input);
  const corruptDatabaseVersions = await markMissingDatabaseVersions({
    database: input.database,
    layout: input.layout,
    repository: new VersionRepository(input.database),
  });
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
    corruptDatabaseVersions,
    presentationReconciliation,
    quarantinedDirectories,
    recoveredCurrentVersions,
    removedStagingDirectories,
  });
}
