import { chmod, lstat, mkdir, readdir, rename } from "node:fs/promises";
import { posix, relative, resolve, sep } from "node:path";
import { readDraftHeader } from "./draft-document";
import { retainedDraftSaveFiles } from "./draft-save-retention";

import type Database from "better-sqlite3";

import { isOpaqueId } from "@/domain/ids";
import { VersionRepository } from "../sqlite/versions";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
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

async function ensureManagedDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  if (!(await existsAsDirectory(path))) {
    throw new Error("STORAGE_DIRECTORY_UNSAFE");
  }
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
  await ensureManagedDirectory(stagingRoot);
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
      await ensureManagedDirectory(quarantineDirectory);
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
  const imports = input.database
    .prepare("SELECT id, state, upload_rel_path FROM imports")
    .all() as {
    id: string;
    state: string;
    upload_rel_path: string;
  }[];
  const known = new Set(
    imports.map((row) => posix.dirname(row.upload_rel_path)),
  );
  for (const imported of imports) {
    if (
      !["canceled", "draft_ready", "expired", "rejected"].includes(
        imported.state,
      ) ||
      !isOpaqueId("import", imported.id) ||
      imported.upload_rel_path !== `tmp/uploads/${imported.id}/original.zip`
    ) {
      continue;
    }
    const sealedExtraction = resolve(
      input.layout.uploadDirectory,
      imported.id,
      "sealed-extraction",
    );
    if (!(await metadata(sealedExtraction))) continue;
    await removeExactContainedTree({
      root: input.layout.root,
      target: sealedExtraction,
    });
    input.removed.push(
      storageRelativePath(input.layout.root, sealedExtraction),
    );
  }
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
  const retained = retainedDraftSaveFiles(input.database, input.layout);
  const covers = resolve(input.layout.temporaryDirectory, "covers");
  if (await existsAsDirectory(covers)) {
    for (const entry of await readdir(covers)) {
      if (!retained.covers.has(`tmp/covers/${entry}`))
        await removeAgedOrphan({ ...input, path: resolve(covers, entry) });
    }
  }
  const originals = new Set(
    (
      input.database
        .prepare("SELECT storage_rel_path FROM original_files")
        .all() as { storage_rel_path: string }[]
    ).map((row) => row.storage_rel_path),
  );
  const assets = new Set(
    (
      input.database
        .prepare("SELECT storage_rel_path FROM book_resources")
        .all() as { storage_rel_path: string }[]
    ).map((row) => row.storage_rel_path),
  );
  const activeInputs = new Set(
    (
      input.database
        .prepare(
          "SELECT captured_input_path FROM jobs WHERE state IN ('queued','running') AND kind='build_candidate' AND captured_input_path IS NOT NULL",
        )
        .all() as { captured_input_path: string }[]
    ).map((row) => posix.dirname(row.captured_input_path)),
  );
  for (const book of await readdir(input.layout.bookDirectory, {
    withFileTypes: true,
  })) {
    if (
      !book.isDirectory() ||
      book.isSymbolicLink() ||
      !/^[1-9][0-9]*$/u.test(book.name)
    )
      continue;
    const root = resolve(input.layout.bookDirectory, book.name);
    for (const [name, known] of [
      ["assets", assets],
      ["originals", originals],
    ] as const) {
      const directory = resolve(root, name);
      if (!(await existsAsDirectory(directory))) continue;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = "books/" + book.name + "/" + name + "/" + entry.name;
        if (known.has(path) && entry.isFile() && !entry.isSymbolicLink())
          continue;
        await removeAgedOrphan({
          ...input,
          path: resolve(directory, entry.name),
        });
      }
    }
    const draft = resolve(root, "draft");
    if (!(await existsAsDirectory(draft))) continue;
    let updatedAt: number;
    try {
      updatedAt = readDraftHeader(
        resolve(draft, "book.json"),
        Number(book.name),
      ).updated_at;
    } catch {
      continue;
    }
    for (const name of ["views", "candidates", "saves"]) {
      const directory = resolve(draft, name);
      if (!(await existsAsDirectory(directory))) continue;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = "books/" + book.name + "/draft/" + name + "/" + entry.name;
        if (
          !entry.isSymbolicLink() &&
          entry.isDirectory() &&
          (name === "views"
            ? entry.name === String(updatedAt)
            : name === "saves"
              ? retained.receipts.has(path)
              : activeInputs.has(path))
        )
          continue;
        await removeAgedOrphan({
          ...input,
          path: resolve(directory, entry.name),
        });
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
