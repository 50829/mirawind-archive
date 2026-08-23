import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";

import { resolveContainedPath, verifyContainedParent } from "./contained-path";

export async function openVerifiedContainedFile(input: {
  readonly expectedSize: number;
  readonly relativePath: string;
  readonly root: string;
}): Promise<FileHandle> {
  let handle: FileHandle | undefined;
  try {
    const path = await resolveContainedPath(input.root, input.relativePath);
    await verifyContainedParent(input.root, path);
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== input.expectedSize) {
      throw new Error("FILE_METADATA_MISMATCH");
    }
    return handle;
  } catch (cause) {
    await handle?.close();
    throw cause;
  }
}

export function fileHandleWebStream(
  handle: FileHandle,
  range?: { readonly end: number; readonly start: number },
): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    handle.createReadStream(
      range ? { end: range.end, start: range.start } : undefined,
    ),
  ) as ReadableStream<Uint8Array>;
}
