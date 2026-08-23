import { open, type FileHandle } from "node:fs/promises";

import {
  Reader,
  Uint8ArrayReader,
  ZipReader,
  type Entry,
} from "@zip.js/zip.js";

import { SafeApplicationError } from "@/domain/errors";
import {
  ArchivePathRegistry,
  type NormalizedArchiveEntryPath,
} from "../../core/preparation/archive-path-policy";

export const maximumArchiveEntries = 20_000;

type ArchiveFormatErrorCode =
  | "ARCHIVE_AMBIGUOUS"
  | "ARCHIVE_COMPRESSION_UNSUPPORTED"
  | "ARCHIVE_CRC_MISMATCH"
  | "ARCHIVE_ENCRYPTED"
  | "ARCHIVE_ENTRY_LIMIT"
  | "ARCHIVE_MALFORMED"
  | "ARCHIVE_MULTI_DISK"
  | "ARCHIVE_OVERLAP"
  | "ARCHIVE_SIZE_MISMATCH"
  | "ARCHIVE_SPECIAL_FILE";

class ArchiveFormatError extends SafeApplicationError {
  constructor(code: ArchiveFormatErrorCode, message: string, cause?: unknown) {
    super(code, message, 400, { cause });
    this.name = "ArchiveFormatError";
  }
}

export interface InspectedArchiveEntry {
  readonly compressedSize: number;
  readonly compressionMethod: 0 | 8;
  readonly directory: boolean;
  readonly diskNumberStart: number;
  readonly encrypted: boolean;
  readonly externalFileAttributes: number;
  readonly entry: Entry;
  readonly path: NormalizedArchiveEntryPath;
  readonly rawBitFlag: number;
  readonly signature: number;
  readonly uncompressedSize: number;
  readonly versionMadeBy: number;
}

export interface InspectedArchive {
  readonly entries: readonly InspectedArchiveEntry[];
}

export class NodeFileReader extends Reader<string> {
  #handle: FileHandle | undefined;
  readonly #path: string;

  constructor(path: string) {
    super(path);
    this.#path = path;
  }

  override async init(): Promise<void> {
    await super.init?.();
    this.#handle = await open(this.#path, "r");
    this.size = (await this.#handle.stat()).size;
  }

  override async readUint8Array(
    index: number,
    length: number,
  ): Promise<Uint8Array> {
    if (!this.#handle) throw new Error("ZIP file reader is not initialized");
    const buffer = Buffer.allocUnsafe(Math.min(length, this.size - index));
    const { bytesRead } = await this.#handle.read(
      buffer,
      0,
      buffer.length,
      index,
    );
    const result = new Uint8Array(bytesRead);
    result.set(buffer.subarray(0, bytesRead));
    return result;
  }

  async dispose(): Promise<void> {
    await this.#handle?.close();
    this.#handle = undefined;
  }
}

export function toArchiveFormatError(error: unknown): ArchiveFormatError {
  if (error instanceof ArchiveFormatError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/overlap/i.test(message)) {
    return new ArchiveFormatError(
      "ARCHIVE_OVERLAP",
      "Archive entry data ranges overlap.",
      error,
    );
  }
  if (/split zip|multi.?disk/i.test(message)) {
    return new ArchiveFormatError(
      "ARCHIVE_MULTI_DISK",
      "Multi-disk ZIP archives are not supported.",
      error,
    );
  }
  if (/signature|crc/i.test(message)) {
    return new ArchiveFormatError(
      "ARCHIVE_CRC_MISMATCH",
      "An archive entry failed its integrity check.",
      error,
    );
  }
  if (/ambigu|duplicate|prepended|appended|local file header/i.test(message)) {
    return new ArchiveFormatError(
      "ARCHIVE_AMBIGUOUS",
      "The archive has an ambiguous ZIP structure.",
      error,
    );
  }
  return new ArchiveFormatError(
    "ARCHIVE_MALFORMED",
    "The ZIP archive is malformed.",
    error,
  );
}

function validateUnixType(entry: Entry): void {
  const platform = entry.versionMadeBy >>> 8;
  if (platform !== 3) return;
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const type = mode & 0o170000;
  if (type === 0) return;
  const expected = entry.directory ? 0o040000 : 0o100000;
  if (type !== expected) {
    throw new ArchiveFormatError(
      "ARCHIVE_SPECIAL_FILE",
      "Archive links and special files are not allowed.",
    );
  }
}

function discardStream(counter?: {
  value: number;
}): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      if (counter) counter.value += chunk.byteLength;
    },
  });
}

async function rawOverlapAndHeaderPass(
  entries: readonly Entry[],
  signal?: AbortSignal,
): Promise<void> {
  for (const entry of entries) {
    if (entry.directory) continue;
    const actual = { value: 0 };
    await entry.getData(discardStream(actual), {
      checkAmbiguity: true,
      checkOverlappingEntry: true,
      passThrough: true,
      ...(signal ? { signal } : {}),
    });
    if (actual.value !== entry.compressedSize) {
      throw new ArchiveFormatError(
        "ARCHIVE_SIZE_MISMATCH",
        "An archive compressed size does not match its metadata.",
      );
    }
  }
}

async function crcAndActualSizePass(entries: readonly Entry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.directory) continue;
    const actual = { value: 0 };
    await entry.getData(discardStream(actual), {
      checkAmbiguity: true,
      checkSignature: true,
    });
    if (actual.value !== entry.uncompressedSize) {
      throw new ArchiveFormatError(
        "ARCHIVE_SIZE_MISMATCH",
        "An archive entry size does not match its metadata.",
      );
    }
  }
}

async function inspectReader<Type>(
  source: Reader<Type>,
  options: {
    readonly signal?: AbortSignal;
    readonly verifyData: boolean;
  },
): Promise<InspectedArchive> {
  const reader = new ZipReader(source, {
    checkAmbiguity: true,
    strictness: "strict",
    useWebWorkers: false,
  });
  try {
    const entries = await reader.getEntries({
      checkAmbiguity: true,
      decodeText(value) {
        return new TextDecoder("utf-8", { fatal: true }).decode(value);
      },
      strictness: "strict",
    });
    if (entries.length > maximumArchiveEntries) {
      throw new ArchiveFormatError(
        "ARCHIVE_ENTRY_LIMIT",
        "The archive contains too many entries.",
      );
    }

    const paths = new ArchivePathRegistry();
    const inspected = entries.map((entry): InspectedArchiveEntry => {
      if (entry.encrypted || ((entry.rawBitFlag ?? 0) & 0x0001) !== 0) {
        throw new ArchiveFormatError(
          "ARCHIVE_ENCRYPTED",
          "Encrypted ZIP entries are not supported.",
        );
      }
      if (entry.diskNumberStart !== 0) {
        throw new ArchiveFormatError(
          "ARCHIVE_MULTI_DISK",
          "Multi-disk ZIP archives are not supported.",
        );
      }
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        throw new ArchiveFormatError(
          "ARCHIVE_COMPRESSION_UNSUPPORTED",
          "The ZIP compression method is not supported.",
        );
      }
      validateUnixType(entry);
      return Object.freeze({
        compressedSize: entry.compressedSize,
        compressionMethod: entry.compressionMethod,
        directory: entry.directory,
        diskNumberStart: entry.diskNumberStart,
        encrypted: entry.encrypted,
        externalFileAttributes: entry.externalFileAttributes,
        entry,
        path: paths.add(entry.rawFilename),
        rawBitFlag: entry.rawBitFlag ?? 0,
        signature: entry.signature,
        uncompressedSize: entry.uncompressedSize,
        versionMadeBy: entry.versionMadeBy,
      });
    });

    await rawOverlapAndHeaderPass(entries, options.signal);
    if (options.verifyData) await crcAndActualSizePass(entries);
    return Object.freeze({ entries: Object.freeze(inspected) });
  } catch (error) {
    throw toArchiveFormatError(error);
  } finally {
    await reader.close();
  }
}

export function inspectZipBytes(
  input: Uint8Array,
  options: {
    readonly signal?: AbortSignal;
    readonly verifyData?: boolean;
  } = {},
): Promise<InspectedArchive> {
  return inspectReader(new Uint8ArrayReader(input), {
    ...(options.signal ? { signal: options.signal } : {}),
    verifyData: options.verifyData ?? true,
  });
}

export async function inspectZipFile(
  path: string,
  options: {
    readonly signal?: AbortSignal;
    readonly verifyData?: boolean;
  } = {},
): Promise<InspectedArchive> {
  const source = new NodeFileReader(path);
  try {
    return await inspectReader(source, {
      ...(options.signal ? { signal: options.signal } : {}),
      verifyData: options.verifyData ?? false,
    });
  } finally {
    await source.dispose();
  }
}
