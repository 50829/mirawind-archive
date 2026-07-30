import { createHash } from "node:crypto";
import {
  chmod,
  constants,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  type FileHandle,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import type Database from "better-sqlite3";

import {
  SourceRepository,
  type OriginalFileRecord,
  type SourceSnapshotRecord,
} from "@/modules/publishing/adapters/sqlite/sources";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import { createOpaqueId } from "@/domain/ids";
import type { StorageLayout } from "@/platform/filesystem/layout";
import {
  openExclusiveFile,
  resolveContainedPath,
} from "@/platform/filesystem/layout";
import { removeExactContainedTree } from "@/platform/filesystem/permanent-removal";

export interface SourceSnapshotResult {
  readonly original: OriginalFileRecord;
  readonly source: SourceSnapshotRecord;
}

export interface CreateSourceSnapshotOptions {
  readonly analysisVersion: string;
  readonly bookId: number;
  readonly extractedRoot: string;
  readonly importId: string;
  readonly mainMarkdownRelativePath: string;
  readonly nowMs?: number;
  readonly originalArchivePath: string;
  readonly originalName: string;
  readonly resourceRelativePaths: readonly string[];
}

function relativeStoragePath(root: string, target: string): string {
  const result = relative(root, target).split(sep).join("/");
  if (!result || result === ".." || result.startsWith("../")) {
    throw new Error("SNAPSHOT_STORAGE_PATH_INVALID");
  }
  return result;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAll(
  output: FileHandle,
  bytes: Uint8Array,
  length: number,
): Promise<void> {
  let offset = 0;
  while (offset < length) {
    const result = await output.write(bytes, offset, length - offset);
    if (result.bytesWritten < 1) throw new Error("SNAPSHOT_WRITE_STALLED");
    offset += result.bytesWritten;
  }
}

async function copyRegularFile(
  source: string,
  target: string,
): Promise<{ readonly sha256: string; readonly sizeBytes: number }> {
  const input = await open(
    source,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let output: FileHandle | undefined;
  try {
    const metadata = await input.stat();
    if (!metadata.isFile()) throw new Error("SNAPSHOT_SOURCE_NOT_REGULAR_FILE");
    output = await openExclusiveFile(target);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const hash = createHash("sha256");
    let sizeBytes = 0;
    for (;;) {
      const result = await input.read(buffer, 0, buffer.byteLength);
      if (result.bytesRead === 0) break;
      const chunk = buffer.subarray(0, result.bytesRead);
      hash.update(chunk);
      await writeAll(output, chunk, result.bytesRead);
      sizeBytes += result.bytesRead;
    }
    await output.chmod(0o400);
    await output.sync();
    await output.close();
    output = undefined;
    return Object.freeze({ sha256: hash.digest("hex"), sizeBytes });
  } finally {
    await input.close();
    if (output) await output.close();
  }
}

async function copySourceClosure(
  sourceRoot: string,
  targetRoot: string,
  mainSourcePath: string,
  resourceRelativePaths: readonly string[],
): Promise<{ readonly mainMarkdownSha256: string }> {
  const resourcePaths: string[] = [];
  const seenResourcePaths = new Set<string>();
  for (const relativePath of resourceRelativePaths) {
    const lexicalPath = await resolveContainedPath(sourceRoot, relativePath);
    const metadata = await lstat(lexicalPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("SNAPSHOT_RESOURCE_NOT_REGULAR_FILE");
    }
    const resourcePath = await realpath(lexicalPath);
    const relation = relative(sourceRoot, resourcePath);
    if (
      !relation ||
      relation === ".." ||
      relation.startsWith(`..${sep}`) ||
      isAbsolute(relation)
    ) {
      throw new Error("SNAPSHOT_RESOURCE_PATH_INVALID");
    }
    if (
      resourcePath === mainSourcePath ||
      seenResourcePaths.has(resourcePath)
    ) {
      throw new Error("SNAPSHOT_RESOURCE_PATH_INVALID");
    }
    seenResourcePaths.add(resourcePath);
    resourcePaths.push(resourcePath);
  }
  const sources = [mainSourcePath, ...resourcePaths].sort((left, right) =>
    Buffer.from(relative(sourceRoot, left)).compare(
      Buffer.from(relative(sourceRoot, right)),
    ),
  );
  const directories = new Set<string>([targetRoot]);
  let mainMarkdownSha256: string | undefined;
  await mkdir(targetRoot, { mode: 0o700 });
  for (const source of sources) {
    const sourceRelativePath = relative(sourceRoot, source);
    if (
      !sourceRelativePath ||
      sourceRelativePath === ".." ||
      sourceRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(sourceRelativePath)
    ) {
      throw new Error("SNAPSHOT_SOURCE_PATH_INVALID");
    }
    const target = resolve(targetRoot, sourceRelativePath);
    const targetDirectory = dirname(target);
    await mkdir(targetDirectory, { mode: 0o700, recursive: true });
    for (
      let directory = targetDirectory;
      directory.startsWith(`${targetRoot}${sep}`);
      directory = dirname(directory)
    ) {
      directories.add(directory);
    }
    const copied = await copyRegularFile(source, target);
    if (source === mainSourcePath) mainMarkdownSha256 = copied.sha256;
  }
  for (const directory of [...directories].sort(
    (left, right) => right.length - left.length,
  )) {
    await syncDirectory(directory);
  }
  if (!mainMarkdownSha256) throw new Error("SNAPSHOT_MAIN_MARKDOWN_MISSING");
  return Object.freeze({ mainMarkdownSha256 });
}

async function lockTreeDirectories(path: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await lockTreeDirectories(resolve(path, entry.name));
    }
  }
  await chmod(path, 0o500);
}

function sanitizedOriginalName(value: string): string {
  const normalized = basename(value)
    .normalize("NFC")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? "_" : character;
    })
    .join("")
    .trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 255) {
    return "mineru.zip";
  }
  return normalized;
}

export class SourceSnapshotService {
  private readonly sources: SourceRepository;

  constructor(
    private readonly database: Database.Database,
    private readonly layout: StorageLayout,
  ) {
    this.sources = new SourceRepository(database);
  }

  async create(
    options: CreateSourceSnapshotOptions,
  ): Promise<SourceSnapshotResult> {
    if (
      !isAbsolute(options.extractedRoot) ||
      !isAbsolute(options.originalArchivePath)
    ) {
      throw new TypeError("Snapshot input paths must be absolute");
    }
    const extractedRoot = await realpath(options.extractedRoot);
    const lexicalMainSourcePath = await resolveContainedPath(
      extractedRoot,
      options.mainMarkdownRelativePath,
    );
    const mainSourcePath = await realpath(lexicalMainSourcePath);
    const mainRelation = relative(extractedRoot, mainSourcePath);
    if (
      mainRelation === ".." ||
      mainRelation.startsWith(`..${sep}`) ||
      isAbsolute(mainRelation)
    ) {
      throw new Error("SNAPSHOT_MAIN_MARKDOWN_INVALID");
    }
    const mainMetadata = await lstat(mainSourcePath);
    if (!mainMetadata.isFile() || mainMetadata.isSymbolicLink()) {
      throw new Error("SNAPSHOT_MAIN_MARKDOWN_INVALID");
    }
    const bundleRoot = dirname(mainSourcePath);
    const relation = relative(extractedRoot, bundleRoot);
    if (
      relation === ".." ||
      relation.startsWith(`..${sep}`) ||
      isAbsolute(relation)
    ) {
      throw new Error("SNAPSHOT_BUNDLE_ROOT_INVALID");
    }

    const sourceId = createOpaqueId("source");
    const originalId = createOpaqueId("file");
    const bookDraftRoot = resolve(
      this.layout.bookDirectory,
      String(options.bookId),
      "draft",
    );
    const stagingRoot = resolve(bookDraftRoot, `.snapshot-${sourceId}.part`);
    const stagedSource = resolve(stagingRoot, "source");
    const stagedOriginal = resolve(stagingRoot, "original.zip");
    const finalSource = resolve(bookDraftRoot, "sources", sourceId);
    const finalOriginal = resolve(bookDraftRoot, "originals", originalId);
    let sourceRenamed = false;
    let originalRenamed = false;
    try {
      await mkdir(bookDraftRoot, { mode: 0o700, recursive: true });
      await mkdir(stagingRoot, { mode: 0o700, recursive: false });
      const copiedSource = await copySourceClosure(
        bundleRoot,
        stagedSource,
        mainSourcePath,
        options.resourceRelativePaths,
      );
      const copiedOriginal = await copyRegularFile(
        options.originalArchivePath,
        stagedOriginal,
      );
      await syncDirectory(stagingRoot);
      await mkdir(dirname(finalSource), { mode: 0o700, recursive: true });
      await mkdir(dirname(finalOriginal), { mode: 0o700, recursive: true });
      await rename(stagedSource, finalSource);
      sourceRenamed = true;
      await rename(stagedOriginal, finalOriginal);
      originalRenamed = true;
      await lockTreeDirectories(finalSource);
      await syncDirectory(dirname(finalSource));
      await syncDirectory(dirname(finalOriginal));

      const result = withImmediateTransaction(this.database, () => {
        const source = this.sources.createSnapshot({
          analysisVersion: options.analysisVersion,
          bookId: options.bookId,
          createdFromImportId: options.importId,
          id: sourceId,
          mainMarkdownPath: basename(mainSourcePath),
          mainMarkdownSha256: copiedSource.mainMarkdownSha256,
          nowMs: options.nowMs ?? Date.now(),
          sourceRootRelativePath: relativeStoragePath(
            this.layout.root,
            finalSource,
          ),
        });
        const original = this.sources.registerOriginal({
          bookId: options.bookId,
          id: originalId,
          mediaType: "application/zip",
          nowMs: options.nowMs ?? Date.now(),
          originalName: sanitizedOriginalName(options.originalName),
          sha256: copiedOriginal.sha256,
          sizeBytes: copiedOriginal.sizeBytes,
          sourceId,
          storageRelativePath: relativeStoragePath(
            this.layout.root,
            finalOriginal,
          ),
        });
        return Object.freeze({ original, source });
      });
      await removeExactContainedTree({
        root: this.layout.root,
        target: stagingRoot,
      });
      return result;
    } catch (error) {
      await Promise.all([
        removeExactContainedTree({
          root: this.layout.root,
          target: stagingRoot,
        }),
        ...(sourceRenamed
          ? [
              removeExactContainedTree({
                root: this.layout.root,
                target: finalSource,
              }),
            ]
          : []),
        ...(originalRenamed
          ? [
              removeExactContainedTree({
                root: this.layout.root,
                target: finalOriginal,
              }),
            ]
          : []),
      ]);
      await rmdir(dirname(finalSource)).catch(() => undefined);
      await rmdir(dirname(finalOriginal)).catch(() => undefined);
      await rmdir(bookDraftRoot).catch(() => undefined);
      throw error;
    }
  }
}
