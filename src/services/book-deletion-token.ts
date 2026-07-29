import { createHash } from "node:crypto";

import { createStrongEtag } from "@/http/cache/policies";

export interface BookDeletionTokenInput {
  readonly alias: string | null;
  readonly bookId: number;
  readonly currentVersionId: string | null;
  readonly draftConfigRevision: number | null;
  readonly draftSourceId: string | null;
  readonly readyPreviewRevision: number | null;
  readonly title: string;
  readonly updatedAtMs: number;
}

function titleDigest(title: string): string {
  return createHash("sha256")
    .update(title.normalize("NFC"), "utf8")
    .digest("base64url");
}

export function createBookDeletionToken(input: BookDeletionTokenInput): string {
  return createStrongEtag(
    "book-permanent-deletion-v1",
    String(input.bookId),
    String(input.updatedAtMs),
    input.alias ?? "",
    input.draftSourceId ?? "",
    String(input.draftConfigRevision ?? ""),
    String(input.readyPreviewRevision ?? ""),
    input.currentVersionId ?? "",
    titleDigest(input.title),
  );
}

export function normalizeMutationToken(value: string): string | null {
  if (
    value.length < 4 ||
    value.length > 200 ||
    !/^"[A-Za-z0-9_-]{20,100}"$/u.test(value)
  ) {
    return null;
  }
  return value;
}
