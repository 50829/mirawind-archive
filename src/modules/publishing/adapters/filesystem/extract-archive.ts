import { mkdir, rm, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ZipReader } from "@zip.js/zip.js";

import { SafeApplicationError } from "@/domain/errors";
import {
  openExclusiveFile,
  resolveContainedPath,
} from "@/platform/filesystem/layout";
import {
  inspectZipFile,
  NodeFileReader,
  toArchiveFormatError,
} from "@/modules/publishing/adapters/filesystem/inspect-zip";

export const archiveResourceLimits = Object.freeze({
  entryBytes: 2 * 1024 * 1024 * 1024,
  expansionRatio: 200,
  expansionRatioThresholdBytes: 64 * 1024 * 1024,
  taskDurationMs: 30 * 60 * 1_000,
  totalBytes: 8 * 1024 * 1024 * 1024,
  uploadBytes: 2 * 1024 * 1024 * 1024,
});

export interface ArchiveExtractionLimits {
  readonly entryBytes: number;
  readonly expansionRatio: number;
  readonly expansionRatioThresholdBytes: number;
  readonly taskDurationMs: number;
  readonly totalBytes: number;
}

export interface ArchiveExtractionResult {
  readonly entries: number;
  readonly files: number;
  readonly totalCompressedBytes: number;
  readonly totalUncompressedBytes: number;
}

type ExtractionErrorCode =
  | "ARCHIVE_CANCELED"
  | "ARCHIVE_ENTRY_SIZE_LIMIT"
  | "ARCHIVE_EXPANSION_RATIO_LIMIT"
  | "ARCHIVE_TIMEOUT"
  | "ARCHIVE_TOTAL_SIZE_LIMIT";

export class ArchiveExtractionError extends SafeApplicationError {
  constructor(code: ExtractionErrorCode, message: string, cause?: unknown) {
    super(code, message, 400, { cause });
    this.name = "ArchiveExtractionError";
  }
}

function resolvedLimits(
  input: Partial<ArchiveExtractionLimits> | undefined,
): ArchiveExtractionLimits {
  const limits = { ...archiveResourceLimits, ...input };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  return limits;
}

function enforceRatio(
  actualBytes: number,
  compressedBytes: number,
  limits: ArchiveExtractionLimits,
): void {
  if (actualBytes <= limits.expansionRatioThresholdBytes) return;
  if (
    compressedBytes === 0 ||
    actualBytes / compressedBytes > limits.expansionRatio
  ) {
    throw new ArchiveExtractionError(
      "ARCHIVE_EXPANSION_RATIO_LIMIT",
      "The archive exceeds the expansion ratio limit.",
    );
  }
}

function checkExecution(
  input: {
    readonly now: () => number;
    readonly signal?: AbortSignal;
    readonly startedAtMs: number;
  },
  limits: ArchiveExtractionLimits,
): void {
  if (input.signal?.aborted) {
    throw new ArchiveExtractionError(
      "ARCHIVE_CANCELED",
      "Archive extraction was canceled.",
    );
  }
  if (input.now() - input.startedAtMs > limits.taskDurationMs) {
    throw new ArchiveExtractionError(
      "ARCHIVE_TIMEOUT",
      "Archive extraction exceeded its time limit.",
    );
  }
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (result.bytesWritten <= 0) {
      throw new Error("Archive extraction write made no progress");
    }
    offset += result.bytesWritten;
  }
}

export async function extractZipFile(input: {
  readonly archivePath: string;
  readonly destination: string;
  readonly limits?: Partial<ArchiveExtractionLimits>;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
}): Promise<ArchiveExtractionResult> {
  const limits = resolvedLimits(input.limits);
  const now = input.now ?? Date.now;
  const startedAtMs = now();
  const destination = resolve(input.destination);
  checkExecution(
    {
      now,
      ...(input.signal ? { signal: input.signal } : {}),
      startedAtMs,
    },
    limits,
  );
  let inspection;
  try {
    inspection = await inspectZipFile(input.archivePath, {
      ...(input.signal ? { signal: input.signal } : {}),
      verifyData: false,
    });
  } catch (error) {
    if (input.signal?.aborted) {
      throw new ArchiveExtractionError(
        "ARCHIVE_CANCELED",
        "Archive extraction was canceled.",
        error,
      );
    }
    throw error;
  }
  const totalCompressedBytes = inspection.entries.reduce(
    (total, entry) => total + (entry.directory ? 0 : entry.compressedSize),
    0,
  );
  let totalUncompressedBytes = 0;
  let files = 0;
  let destinationCreated = false;
  const source = new NodeFileReader(input.archivePath);
  const reader = new ZipReader(source, {
    checkAmbiguity: true,
    strictness: "strict",
    useWebWorkers: false,
  });

  try {
    await mkdir(destination, { mode: 0o700, recursive: false });
    destinationCreated = true;
    const entries = await reader.getEntries({
      checkAmbiguity: true,
      decodeText(value) {
        return new TextDecoder("utf-8", { fatal: true }).decode(value);
      },
      strictness: "strict",
    });
    if (entries.length !== inspection.entries.length) {
      throw new Error("Archive entry set changed between validation passes");
    }

    for (let index = 0; index < entries.length; index += 1) {
      checkExecution(
        {
          now,
          ...(input.signal ? { signal: input.signal } : {}),
          startedAtMs,
        },
        limits,
      );
      const entry = entries[index];
      const inspected = inspection.entries[index];
      if (!entry || !inspected) {
        throw new Error("Archive entry set is incomplete");
      }
      if (entry.directory !== inspected.directory) {
        throw new Error("Archive entry type changed between validation passes");
      }
      const target = await resolveContainedPath(
        destination,
        inspected.path.normalizedPath,
      );
      if (entry.directory) {
        await mkdir(target, { mode: 0o700, recursive: true });
        continue;
      }

      await mkdir(dirname(target), { mode: 0o700, recursive: true });
      const handle = await openExclusiveFile(target);
      let entryBytes = 0;
      let enforcementError: SafeApplicationError | undefined;
      try {
        try {
          await entry.getData(
            new WritableStream<Uint8Array>({
              async write(chunk) {
                try {
                  checkExecution(
                    {
                      now,
                      ...(input.signal ? { signal: input.signal } : {}),
                      startedAtMs,
                    },
                    limits,
                  );
                  entryBytes += chunk.byteLength;
                  totalUncompressedBytes += chunk.byteLength;
                  if (entryBytes > limits.entryBytes) {
                    throw new ArchiveExtractionError(
                      "ARCHIVE_ENTRY_SIZE_LIMIT",
                      "An archive entry exceeds the extracted byte limit.",
                    );
                  }
                  if (totalUncompressedBytes > limits.totalBytes) {
                    throw new ArchiveExtractionError(
                      "ARCHIVE_TOTAL_SIZE_LIMIT",
                      "The archive exceeds the total extracted byte limit.",
                    );
                  }
                  enforceRatio(entryBytes, inspected.compressedSize, limits);
                  enforceRatio(
                    totalUncompressedBytes,
                    totalCompressedBytes,
                    limits,
                  );
                  await writeAll(handle, chunk);
                } catch (error) {
                  if (error instanceof SafeApplicationError) {
                    enforcementError = error;
                  }
                  throw error;
                }
              },
            }),
            {
              checkAmbiguity: true,
              checkSignature: true,
              ...(input.signal ? { signal: input.signal } : {}),
            },
          );
        } catch (error) {
          if (enforcementError) throw enforcementError;
          if (input.signal?.aborted) {
            throw new ArchiveExtractionError(
              "ARCHIVE_CANCELED",
              "Archive extraction was canceled.",
              error,
            );
          }
          throw error;
        }
        if (entryBytes !== inspected.uncompressedSize) {
          throw new Error("Archive entry size changed during extraction");
        }
        await handle.chmod(0o600);
        await handle.sync();
      } finally {
        await handle.close();
      }
      files += 1;
    }
    enforceRatio(totalUncompressedBytes, totalCompressedBytes, limits);
    return Object.freeze({
      entries: inspection.entries.length,
      files,
      totalCompressedBytes,
      totalUncompressedBytes,
    });
  } catch (error) {
    if (destinationCreated) {
      await rm(destination, { force: true, recursive: true });
    }
    if (error instanceof SafeApplicationError) throw error;
    throw toArchiveFormatError(error);
  } finally {
    await reader.close();
    await source.dispose();
  }
}
