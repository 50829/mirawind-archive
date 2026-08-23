import { createHash } from "node:crypto";
import { mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";

import { ImportRepository, type ImportRecord } from "../sqlite/imports";
import { JobRepository, type JobRecord } from "../sqlite/jobs";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import { SafeApplicationError } from "@/domain/errors";
import { createOpaqueId } from "@/domain/ids";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { openExclusiveFile } from "@/platform/filesystem/atomic-file";
import {
  importUploadIdempotencyOperation,
  maximumUploadBytes,
} from "../../application/publishing-api";

const idempotencyOperation = importUploadIdempotencyOperation;

export interface ImportUploadResult {
  readonly import: ImportRecord;
  readonly job: JobRecord;
}

export interface StoreImportUploadOptions {
  readonly bookId?: number | Promise<number | undefined>;
  readonly bytes: AsyncIterable<Uint8Array>;
  readonly expiresAtMs: number;
  readonly idempotencyKey: string;
  readonly maximumBytes?: number;
  readonly nowMs?: number;
  readonly originalName: string;
  readonly signal?: AbortSignal;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function storageRelativePath(root: string, absolutePath: string): string {
  const result = relative(root, absolutePath).split(sep).join("/");
  if (!result || result === ".." || result.startsWith("../")) {
    throw new Error("UPLOAD_STORAGE_PATH_INVALID");
  }
  return result;
}

async function writeUpload(
  handle: FileHandle,
  bytes: AsyncIterable<Uint8Array>,
  maximumBytes: number,
  signal: AbortSignal | undefined,
): Promise<{ readonly sha256: string; readonly sizeBytes: number }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  if (signal?.aborted) {
    throw new SafeApplicationError(
      "UPLOAD_CANCELED",
      "The upload was canceled.",
      499,
    );
  }
  for await (const chunk of bytes) {
    if (signal?.aborted) {
      throw new SafeApplicationError(
        "UPLOAD_CANCELED",
        "The upload was canceled.",
        499,
      );
    }
    sizeBytes += chunk.byteLength;
    if (sizeBytes > maximumBytes) {
      throw new SafeApplicationError(
        "UPLOAD_SIZE_LIMIT",
        "The upload exceeds the 2 GiB limit.",
        413,
      );
    }
    hash.update(chunk);
    await handle.writeFile(chunk);
  }
  await handle.sync();
  return Object.freeze({
    sha256: hash.digest("hex"),
    sizeBytes,
  });
}

export class ImportUploadService {
  private readonly imports: ImportRepository;
  private readonly jobs: JobRepository;

  constructor(
    private readonly database: Database.Database,
    private readonly layout: StorageLayout,
  ) {
    this.imports = new ImportRepository(database);
    this.jobs = new JobRepository(database);
  }

  async store(options: StoreImportUploadOptions): Promise<ImportUploadResult> {
    const existing = this.jobs.findByIdempotency(
      idempotencyOperation,
      options.idempotencyKey,
    );
    if (existing?.importId) {
      return Object.freeze({
        import: this.imports.require(existing.importId),
        job: existing,
      });
    }
    const nowMs = options.nowMs ?? Date.now();
    const requestedMaximum = options.maximumBytes ?? maximumUploadBytes;
    if (
      !Number.isSafeInteger(requestedMaximum) ||
      requestedMaximum < 1 ||
      requestedMaximum > maximumUploadBytes
    ) {
      throw new TypeError("Upload byte limit is invalid");
    }
    const importId = createOpaqueId("import");
    const directory = resolve(this.layout.uploadDirectory, importId);
    const partialPath = resolve(directory, "original.zip.part");
    const finalPath = resolve(directory, "original.zip");
    await mkdir(directory, { mode: 0o700 });
    let handle: FileHandle | undefined;
    let renamed = false;
    try {
      handle = await openExclusiveFile(partialPath);
      const written = await writeUpload(
        handle,
        options.bytes,
        requestedMaximum,
        options.signal,
      );
      if (options.signal?.aborted) {
        throw new SafeApplicationError(
          "UPLOAD_CANCELED",
          "The upload was canceled.",
          499,
        );
      }
      await handle.close();
      handle = undefined;
      await rename(partialPath, finalPath);
      renamed = true;
      await syncDirectory(directory);
      await syncDirectory(this.layout.uploadDirectory);
      const bookId = await options.bookId;
      const result = withImmediateTransaction(this.database, () => {
        const importRecord = this.imports.createUploaded({
          ...(bookId === undefined ? {} : { bookId }),
          expiresAtMs: options.expiresAtMs,
          id: importId,
          nowMs,
          originalName: options.originalName,
          uploadRelativePath: storageRelativePath(this.layout.root, finalPath),
          uploadSha256: written.sha256,
          uploadSizeBytes: written.sizeBytes,
        });
        const job = this.jobs.create({
          ...(bookId === undefined ? {} : { bookId }),
          idempotency: {
            key: options.idempotencyKey,
            operation: idempotencyOperation,
          },
          importId,
          kind: "analyze_import",
          nowMs,
          phase: "queued",
        });
        if (job.importId !== importId) {
          throw new Error("UPLOAD_IDEMPOTENCY_CONFLICT");
        }
        return Object.freeze({ import: importRecord, job });
      });
      return result;
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await rm(directory, { force: true, recursive: true });
      if (renamed) await syncDirectory(this.layout.uploadDirectory);
      throw error;
    }
  }
}
