import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { JSONParser } from "@streamparser/json";

import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import {
  contentLimits,
  maximumContentTimestamp,
  validateBookDocument,
} from "../../core/content/book-document";
import type { BookDocument } from "../../core/content/book-document.generated";
import { readJsonDocument } from "./read-json-document";

export interface DraftHeader {
  readonly book_id: number;
  readonly schema_version: 1;
  readonly updated_at: number;
}
export function bookStorageRoot(
  layout: Pick<StorageLayout, "bookDirectory">,
  bookId: number,
): string {
  if (!Number.isSafeInteger(bookId) || bookId < 1)
    throw new Error("BOOK_ID_INVALID");
  return resolve(layout.bookDirectory, String(bookId));
}
export function draftDocumentPath(
  layout: Pick<StorageLayout, "bookDirectory">,
  bookId: number,
): string {
  return resolve(bookStorageRoot(layout, bookId), "draft/book.json");
}
export function candidateInputRelativePath(
  bookId: number,
  candidateId: string,
): string {
  if (
    !Number.isSafeInteger(bookId) ||
    bookId < 1 ||
    !isOpaqueId("draftCandidate", candidateId)
  )
    throw new Error("CANDIDATE_INPUT_INVALID");
  return `books/${bookId}/draft/candidates/${candidateId}/book.json`;
}

export function readDraftHeader(
  path: string,
  expectedBookId: number,
): DraftHeader {
  const parser = new JSONParser({
    paths: ["$.schema_version", "$.book_id", "$.updated_at"],
    keepStack: false,
  });
  const header: Record<string, unknown> = {};
  parser.onValue = ({ key, value }) => {
    if (typeof key === "string") header[key] = value;
  };
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > contentLimits.bytes)
      throw new Error("DRAFT_FILE_INVALID");
    const buffer = Buffer.alloc(256);
    for (let offset = 0; offset < 4096 && Object.keys(header).length < 3;) {
      const size = readSync(descriptor, buffer, 0, buffer.length, offset);
      if (!size) break;
      parser.write(buffer.subarray(0, size));
      offset += size;
    }
    if (
      header.schema_version !== 1 ||
      header.book_id !== expectedBookId ||
      !Number.isSafeInteger(header.updated_at) ||
      Number(header.updated_at) < 0 ||
      Number(header.updated_at) > maximumContentTimestamp
    )
      throw new Error("DRAFT_HEADER_INVALID");
    return {
      schema_version: 1,
      book_id: expectedBookId,
      updated_at: Number(header.updated_at),
    };
  } finally {
    closeSync(descriptor);
  }
}

export async function readDraftDocument(
  layout: StorageLayout,
  bookId: number,
  signal?: AbortSignal,
): Promise<BookDocument> {
  return validateBookDocument(
    await readJsonDocument(draftDocumentPath(layout, bookId), signal),
    bookId,
  );
}
export function requireDraftTimestamp(
  layout: StorageLayout,
  bookId: number,
  expectedUpdatedAt: number,
): DraftHeader {
  const header = readDraftHeader(draftDocumentPath(layout, bookId), bookId);
  if (header.updated_at !== expectedUpdatedAt)
    throw new SafeApplicationError(
      "DRAFT_PRECONDITION_FAILED",
      "The draft changed since it was read.",
      412,
    );
  return header;
}
