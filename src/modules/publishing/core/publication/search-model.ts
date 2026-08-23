import { createHash } from "node:crypto";

import type { TransientDocumentNode } from "../preparation/document-model";
import type { CompiledBook } from "./compiled-book";
import { canonicalJson } from "./manifest";

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

export interface SearchRowCursor {
  readonly currentHeading: string;
  readonly nextOrdinal: number;
}

function normalize(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").normalize("NFC");
}

export function buildSearchRowsForBlocks(input: {
  readonly authors: readonly string[];
  readonly blocks: readonly TransientDocumentNode[];
  readonly book: CompiledBook;
  readonly bookId: number;
  readonly cursor: SearchRowCursor;
  readonly endIndex?: number;
  readonly startIndex?: number;
  readonly title: string;
  readonly versionId: string;
}): {
  readonly cursor: SearchRowCursor;
  readonly rows: readonly SearchFtsRow[];
} {
  const authors = normalize(input.authors.join("\n"));
  const title = normalize(input.title);
  let currentHeading = input.cursor.currentHeading;
  let ordinal = input.cursor.nextOrdinal;
  const rows: SearchFtsRow[] = [];
  const startIndex = input.startIndex ?? 0;
  const endIndex = input.endIndex ?? input.blocks.length;
  if (
    !Number.isSafeInteger(startIndex) ||
    !Number.isSafeInteger(endIndex) ||
    startIndex < 0 ||
    endIndex < startIndex ||
    endIndex > input.blocks.length
  ) {
    throw new Error("SEARCH_BLOCK_RANGE_INVALID");
  }
  for (let index = startIndex; index < endIndex; index += 1) {
    const block = input.blocks[index];
    if (!block) throw new Error("SEARCH_BLOCK_RANGE_INVALID");
    if (block.type === "heading" && block.blockId) {
      currentHeading =
        input.book.headingByBlockId.get(block.blockId)?.label ??
        block.visibleText ??
        "";
    }
    if (!block.blockId || !(block.visibleText ?? "").trim()) continue;
    const pageId = input.book.pageByBlockId.get(block.blockId)?.pageId;
    if (!pageId) throw new Error("SEARCH_BLOCK_PAGE_MISSING");
    rows.push(
      Object.freeze({
        authors,
        blockId: block.blockId,
        body: normalize(
          block.type === "heading" && block.blockId
            ? (input.book.headingByBlockId.get(block.blockId)?.label ??
                block.visibleText ??
                "")
            : (block.visibleText ?? ""),
        ),
        bookId: input.bookId,
        heading: normalize(currentHeading),
        kind: block.type,
        ordinal,
        pageId,
        title,
        versionId: input.versionId,
      }),
    );
    ordinal += 1;
  }
  return Object.freeze({
    cursor: Object.freeze({ currentHeading, nextOrdinal: ordinal }),
    rows: Object.freeze(rows),
  });
}

export function buildSearchShortRows(input: {
  readonly authors: readonly string[];
  readonly book: CompiledBook;
  readonly bookId: number;
  readonly title: string;
  readonly versionId: string;
}): readonly SearchShortRow[] {
  const shortRows: SearchShortRow[] = [];
  shortRows.push(
    Object.freeze({
      blockId: null,
      bookId: input.bookId,
      kind: "title",
      normalizedText: normalize(input.title),
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
  for (const heading of input.book.headings) {
    const pageId = input.book.pageByHeadingId.get(heading.block_id)?.pageId;
    if (!pageId) throw new Error("SEARCH_HEADING_PAGE_MISSING");
    shortRows.push(
      Object.freeze({
        blockId: heading.block_id,
        bookId: input.bookId,
        kind: "heading",
        normalizedText: normalize(heading.label),
        ordinal: shortRows.length,
        pageId,
        versionId: input.versionId,
      }),
    );
  }
  return Object.freeze(shortRows);
}

export function buildSearchSpool(input: {
  readonly authors: readonly string[];
  readonly book: CompiledBook;
  readonly bookId: number;
  readonly title: string;
  readonly versionId: string;
}): SearchSpool {
  const search = buildSearchRowsForBlocks({
    ...input,
    blocks: input.book.document.blocks,
    cursor: { currentHeading: "", nextOrdinal: 0 },
  });
  const ftsRows = search.rows;
  const shortRows = buildSearchShortRows(input);
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
