import { createHash } from "node:crypto";

import { canonicalJson } from "../document/manifest.js";
import type { NormalizedDocument } from "../document/types.js";
import type { NumberedHeading } from "../document/numbering.js";
import type { CompiledDocumentPage } from "../document/pages.js";
import { atomicWriteFile } from "../../storage/layout.js";

export interface SearchFtsRow {
  readonly authors: string;
  readonly blockId: string;
  readonly body: string;
  readonly bookId: number;
  readonly heading: string;
  readonly kind: string;
  readonly ordinal: number;
  readonly pageId: number;
  readonly title: string;
  readonly versionId: string;
}

export interface SearchShortRow {
  readonly blockId: string | null;
  readonly bookId: number;
  readonly kind: "author" | "heading" | "title";
  readonly normalizedText: string;
  readonly ordinal: number;
  readonly pageId: number;
  readonly versionId: string;
}

export interface SearchSpool {
  readonly digest: string;
  readonly ftsRows: readonly SearchFtsRow[];
  readonly schemaVersion: 1;
  readonly shortRows: readonly SearchShortRow[];
}

function normalize(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").normalize("NFC");
}

export function buildSearchSpool(input: {
  readonly authors: readonly string[];
  readonly bookId: number;
  readonly document: NormalizedDocument;
  readonly headings: readonly NumberedHeading[];
  readonly pages: readonly CompiledDocumentPage[];
  readonly title: string;
  readonly versionId: string;
}): SearchSpool {
  const pageByBlockId = new Map(
    input.pages.flatMap((page) =>
      page.blockIds.map((blockId) => [blockId, page.pageId] as const),
    ),
  );
  const configuredHeading = new Map(
    input.headings.map((heading) => [heading.block_id, heading]),
  );
  const authors = normalize(input.authors.join("\n"));
  const title = normalize(input.title);
  let currentHeading = "";
  const ftsRows: SearchFtsRow[] = [];
  for (const block of input.document.blocks) {
    if (block.type === "heading" && block.blockId) {
      currentHeading =
        configuredHeading.get(block.blockId)?.display_title ??
        block.visibleText ??
        "";
    }
    if (!block.blockId || !(block.visibleText ?? "").trim()) continue;
    const pageId = pageByBlockId.get(block.blockId);
    if (!pageId) throw new Error("SEARCH_BLOCK_PAGE_MISSING");
    ftsRows.push(
      Object.freeze({
        authors,
        blockId: block.blockId,
        body: normalize(block.visibleText ?? ""),
        bookId: input.bookId,
        heading: normalize(currentHeading),
        kind: block.type,
        ordinal: ftsRows.length,
        pageId,
        title,
        versionId: input.versionId,
      }),
    );
  }
  const shortRows: SearchShortRow[] = [];
  shortRows.push(
    Object.freeze({
      blockId: null,
      bookId: input.bookId,
      kind: "title",
      normalizedText: title,
      ordinal: shortRows.length,
      pageId: 1,
      versionId: input.versionId,
    }),
  );
  for (const author of input.authors) {
    const normalized = normalize(author).trim();
    if (!normalized) continue;
    shortRows.push(
      Object.freeze({
        blockId: null,
        bookId: input.bookId,
        kind: "author",
        normalizedText: normalized,
        ordinal: shortRows.length,
        pageId: 1,
        versionId: input.versionId,
      }),
    );
  }
  for (const heading of input.headings) {
    const pageId = pageByBlockId.get(heading.block_id);
    if (!pageId) throw new Error("SEARCH_HEADING_PAGE_MISSING");
    shortRows.push(
      Object.freeze({
        blockId: heading.block_id,
        bookId: input.bookId,
        kind: "heading",
        normalizedText: normalize(heading.display_title),
        ordinal: shortRows.length,
        pageId,
        versionId: input.versionId,
      }),
    );
  }
  const payload = {
    ftsRows,
    schemaVersion: 1 as const,
    shortRows,
  };
  return Object.freeze({
    ...payload,
    digest: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
    ftsRows: Object.freeze(ftsRows),
    shortRows: Object.freeze(shortRows),
  });
}

export async function writeSearchSpool(
  path: string,
  spool: SearchSpool,
): Promise<void> {
  await atomicWriteFile(path, canonicalJson(spool), { mode: 0o400 });
}

export function parseSearchSpool(value: string): SearchSpool {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SEARCH_SPOOL_INVALID");
  }
  const spool = parsed as Record<string, unknown>;
  if (
    spool.schemaVersion !== 1 ||
    typeof spool.digest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(spool.digest) ||
    !Array.isArray(spool.ftsRows) ||
    !Array.isArray(spool.shortRows)
  ) {
    throw new Error("SEARCH_SPOOL_INVALID");
  }
  const payload = {
    ftsRows: spool.ftsRows,
    schemaVersion: 1,
    shortRows: spool.shortRows,
  };
  if (
    createHash("sha256").update(canonicalJson(payload)).digest("hex") !==
    spool.digest
  ) {
    throw new Error("SEARCH_SPOOL_HASH_MISMATCH");
  }
  return parsed as SearchSpool;
}
