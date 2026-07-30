import { chmod, lstat, mkdir, readdir, rename } from "node:fs/promises";
import { posix, relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";

import { isOpaqueId } from "@/domain/ids";
import { VersionRepository } from "@/modules/publishing/adapters/sqlite/versions";
import type { StorageLayout } from "@/platform/filesystem/layout";
import { removeExactContainedTree } from "@/platform/filesystem/permanent-removal";

export const publishingOrphanGraceMs = 60 * 60 * 1_000;

export interface PublishingStorageReconciliation {
  readonly corruptDatabaseVersions: readonly string[];
  readonly quarantinedDirectories: readonly string[];
  readonly removedOrphanPaths: readonly string[];
  readonly removedStagingDirectories: readonly string[];
}

async function metadata(path: string) {
  return lstat(path).catch((error: unknown) => {
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
}

async function existsAsDirectory(path: string): Promise<boolean> {
  const value = await metadata(path);
  return value !== null && !value.isSymbolicLink() && value.isDirectory();
}

function storageRelativePath(root: string, target: string): string {
  return relative(root, target).split(sep).join("/");
}

async function newestDirectModificationMs(path: string): Promise<number> {
  const root = await metadata(path);
  if (!root) return Number.POSITIVE_INFINITY;
  let newest = root.mtimeMs;
  if (!root.isDirectory() || root.isSymbolicLink()) return newest;
  const entries = await readdir(path).catch((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  });
  for (const entry of entries) {
    const child = await metadata(resolve(path, entry));
    if (child) newest = Math.max(newest, child.mtimeMs);
  }
  return newest;
}

async function removeAgedOrphan(input: {
  readonly cutoffMs: number;
  readonly layout: StorageLayout;
  readonly path: string;
  readonly removed: string[];
}): Promise<void> {
  if ((await newestDirectModificationMs(input.path)) > input.cutoffMs) return;
  await removeExactContainedTree({
    root: input.layout.root,
    target: input.path,
  });
  input.removed.push(storageRelativePath(input.layout.root, input.path));
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
    await removeExactContainedTree({ root: input.layout.root, target: path });
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

async function reconcileUploadOrphans(input: {
  readonly cutoffMs: number;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly removed: string[];
}): Promise<void> {
  const known = new Set(
    (
      input.database.prepare("SELECT upload_rel_path FROM imports").all() as {
        upload_rel_path: string;
      }[]
    ).map((row) => posix.dirname(row.upload_rel_path)),
  );
  const entries = await readdir(input.layout.uploadDirectory, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    const relativePath = `tmp/uploads/${entry.name}`;
    if (
      known.has(relativePath) &&
      entry.isDirectory() &&
      !entry.isSymbolicLink()
    ) {
      continue;
    }
    await removeAgedOrphan({
      cutoffMs: input.cutoffMs,
      layout: input.layout,
      path: resolve(input.layout.uploadDirectory, entry.name),
      removed: input.removed,
    });
  }
}

async function reconcileDraftOrphans(input: {
  readonly cutoffMs: number;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly removed: string[];
}): Promise<void> {
  const sourcePaths = new Set(
    (
      input.database
        .prepare("SELECT source_root_rel_path FROM source_snapshots")
        .all() as { source_root_rel_path: string }[]
    ).map((row) => row.source_root_rel_path),
  );
  const originalPaths = new Set(
    (
      input.database
        .prepare("SELECT storage_rel_path FROM original_files")
        .all() as { storage_rel_path: string }[]
    ).map((row) => row.storage_rel_path),
  );
  const configurations = input.database
    .prepare(
      "SELECT book_id, revision, source_id, yaml_rel_path FROM config_revisions",
    )
    .all() as {
    book_id: number;
    revision: number;
    source_id: string;
    yaml_rel_path: string;
  }[];
  const configDirectories = new Set(
    configurations.map((row) => posix.dirname(row.yaml_rel_path)),
  );
  const analysisPaths = new Set(
    configurations.map(
      (row) =>
        `books/${row.book_id}/draft/analyses/${row.source_id}/${row.revision}.json`,
    ),
  );

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
    const draftRoot = resolve(input.layout.bookDirectory, book.name, "draft");
    if (!(await existsAsDirectory(draftRoot))) continue;
    const draftEntries = await readdir(draftRoot, { withFileTypes: true });
    for (const entry of draftEntries) {
      if (entry.name.startsWith(".snapshot-") && entry.name.endsWith(".part")) {
        await removeAgedOrphan({
          cutoffMs: input.cutoffMs,
          layout: input.layout,
          path: resolve(draftRoot, entry.name),
          removed: input.removed,
        });
      }
    }

    for (const [directoryName, known] of [
      ["sources", sourcePaths],
      ["originals", originalPaths],
    ] as const) {
      const directory = resolve(draftRoot, directoryName);
      if (!(await existsAsDirectory(directory))) continue;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = `books/${book.name}/draft/${directoryName}/${entry.name}`;
        if (known.has(relativePath) && !entry.isSymbolicLink()) continue;
        await removeAgedOrphan({
          cutoffMs: input.cutoffMs,
          layout: input.layout,
          path: resolve(directory, entry.name),
          removed: input.removed,
        });
      }
    }

    const configsRoot = resolve(draftRoot, "configs");
    if (await existsAsDirectory(configsRoot)) {
      const revisions = await readdir(configsRoot, { withFileTypes: true });
      for (const revision of revisions) {
        const relativePath = `books/${book.name}/draft/configs/${revision.name}`;
        if (
          configDirectories.has(relativePath) &&
          revision.isDirectory() &&
          !revision.isSymbolicLink()
        ) {
          continue;
        }
        await removeAgedOrphan({
          cutoffMs: input.cutoffMs,
          layout: input.layout,
          path: resolve(configsRoot, revision.name),
          removed: input.removed,
        });
      }
    }

    const analysesRoot = resolve(draftRoot, "analyses");
    if (await existsAsDirectory(analysesRoot)) {
      const sources = await readdir(analysesRoot, { withFileTypes: true });
      for (const source of sources) {
        const sourceDirectory = resolve(analysesRoot, source.name);
        if (!source.isDirectory() || source.isSymbolicLink()) {
          await removeAgedOrphan({
            cutoffMs: input.cutoffMs,
            layout: input.layout,
            path: sourceDirectory,
            removed: input.removed,
          });
          continue;
        }
        const analyses = await readdir(sourceDirectory, {
          withFileTypes: true,
        });
        for (const analysis of analyses) {
          const relativePath = `books/${book.name}/draft/analyses/${source.name}/${analysis.name}`;
          if (analysisPaths.has(relativePath) && !analysis.isSymbolicLink()) {
            continue;
          }
          await removeAgedOrphan({
            cutoffMs: input.cutoffMs,
            layout: input.layout,
            path: resolve(sourceDirectory, analysis.name),
            removed: input.removed,
          });
        }
      }
    }
  }
}

export async function reconcilePublishingStorage(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<PublishingStorageReconciliation> {
  const removedOrphanPaths: string[] = [];
  const cutoffMs = input.nowMs - publishingOrphanGraceMs;
  await reconcileUploadOrphans({
    cutoffMs,
    database: input.database,
    layout: input.layout,
    removed: removedOrphanPaths,
  });
  await reconcileDraftOrphans({
    cutoffMs,
    database: input.database,
    layout: input.layout,
    removed: removedOrphanPaths,
  });
  const removedStagingDirectories = await reconcileStaging(input);
  const quarantinedDirectories = await quarantineOrphanVersions(input);
  const corruptDatabaseVersions = await markMissingDatabaseVersions({
    database: input.database,
    layout: input.layout,
    repository: new VersionRepository(input.database),
  });
  return Object.freeze({
    corruptDatabaseVersions,
    quarantinedDirectories,
    removedOrphanPaths: Object.freeze(removedOrphanPaths.sort()),
    removedStagingDirectories,
  });
}
