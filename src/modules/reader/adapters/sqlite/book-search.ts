import type Database from "better-sqlite3";

import type { NormalizedSearchQuery } from "@/modules/reader/core/search-query";

export interface BookSearchResult {
  readonly blockId: string;
  readonly bookId: number;
  readonly href: string;
  readonly kind: "author" | "body" | "heading" | "title";
  readonly pageId: number;
  readonly snippet: string;
  readonly title: string;
}

interface FtsResultRow {
  authors: string;
  block_id: string;
  body: string;
  heading: string;
  kind: string;
  page_id: number | string;
  title: string;
}

interface ShortResultRow {
  block_id: string;
  kind: "author" | "heading" | "title";
  normalized_text: string;
  page_id: number;
  title: string;
}

function textSnippet(value: string, query: string): string {
  const compact = value.replaceAll(/\s+/gu, " ").trim();
  if (compact.length <= 500) return compact;
  const position = compact
    .toLocaleLowerCase()
    .indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, position < 0 ? 0 : position - 160);
  const end = Math.min(compact.length, start + 500);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function matchKind(row: FtsResultRow, query: string): BookSearchResult["kind"] {
  const needle = query.toLocaleLowerCase();
  if (row.body.toLocaleLowerCase().includes(needle)) {
    return row.kind === "heading" ? "heading" : "body";
  }
  if (row.title.toLocaleLowerCase().includes(needle)) return "title";
  if (row.authors.toLocaleLowerCase().includes(needle)) return "author";
  if (row.heading.toLocaleLowerCase().includes(needle)) return "heading";
  return "body";
}

export class BookSearchRepository {
  constructor(private readonly database: Database.Database) {}

  search(input: {
    readonly bookId: number;
    readonly bookKey: string;
    readonly limit: number;
    readonly offset: number;
    readonly query: NormalizedSearchQuery;
    readonly requirePublic: boolean;
    readonly versionId: string;
  }): readonly BookSearchResult[] {
    if (input.query.scope === "metadata_heading_only") {
      return this.searchShort(input);
    }
    return this.searchFts(input);
  }

  private searchFts(input: {
    readonly bookId: number;
    readonly bookKey: string;
    readonly limit: number;
    readonly offset: number;
    readonly query: NormalizedSearchQuery;
    readonly requirePublic: boolean;
    readonly versionId: string;
  }): readonly BookSearchResult[] {
    const rows = this.database
      .prepare(
        `SELECT search_fts.title, search_fts.authors, search_fts.heading,
                search_fts.body, search_fts.page_id, search_fts.block_id,
                search_fts.kind
         FROM search_fts
         JOIN books ON books.id = CAST(search_fts.book_id AS INTEGER)
         WHERE search_fts MATCH ?
           AND CAST(search_fts.book_id AS INTEGER) = ?
           AND search_fts.version_id = ?
           AND books.current_version_id = search_fts.version_id
           AND books.deletion_requested_at IS NULL
           AND (? = 0 OR books.visibility = 'public')
         ORDER BY rank, CAST(search_fts.ordinal AS INTEGER)
         LIMIT ? OFFSET ?`,
      )
      .all(
        input.query.ftsLiteralPhrase,
        input.bookId,
        input.versionId,
        input.requirePublic ? 1 : 0,
        input.limit,
        input.offset,
      ) as FtsResultRow[];
    const seen = new Set<string>();
    return Object.freeze(
      rows.flatMap((row) => {
        const kind = matchKind(row, input.query.normalized);
        const blockId = row.block_id;
        const pageId = Number(row.page_id);
        const key =
          kind === "title" || kind === "author"
            ? kind
            : `${kind}:${pageId}:${blockId}`;
        if (seen.has(key)) return [];
        seen.add(key);
        const source =
          kind === "title"
            ? row.title
            : kind === "author"
              ? row.authors
              : kind === "heading"
                ? row.heading
                : row.body;
        return [
          Object.freeze({
            blockId,
            bookId: input.bookId,
            href: `/read/${input.bookKey}/${pageId}#${blockId}`,
            kind,
            pageId,
            snippet: textSnippet(source, input.query.normalized),
            title: row.title.slice(0, 500),
          }),
        ];
      }),
    );
  }

  private searchShort(input: {
    readonly bookId: number;
    readonly bookKey: string;
    readonly limit: number;
    readonly offset: number;
    readonly query: NormalizedSearchQuery;
    readonly requirePublic: boolean;
    readonly versionId: string;
  }): readonly BookSearchResult[] {
    const rows = this.database
      .prepare(
        `SELECT search_short_fields.kind,
                search_short_fields.normalized_text,
                search_short_fields.page_id,
                COALESCE(
                  search_short_fields.block_id,
                  (
                    SELECT search_fts.block_id
                    FROM search_fts
                    WHERE search_fts.version_id = search_short_fields.version_id
                      AND CAST(search_fts.page_id AS INTEGER) =
                          search_short_fields.page_id
                    ORDER BY CAST(search_fts.ordinal AS INTEGER)
                    LIMIT 1
                  )
                ) AS block_id,
                presentation.title AS title
         FROM search_short_fields
         JOIN books ON books.id = search_short_fields.book_id
         JOIN book_version_presentations AS presentation
           ON presentation.version_id = search_short_fields.version_id
          AND presentation.book_id = books.id
         WHERE search_short_fields.book_id = ?
           AND search_short_fields.version_id = ?
           AND books.current_version_id = search_short_fields.version_id
           AND books.deletion_requested_at IS NULL
           AND (? = 0 OR books.visibility = 'public')
           AND instr(
                 lower(search_short_fields.normalized_text),
                 lower(?)
               ) > 0
         ORDER BY search_short_fields.ordinal
         LIMIT ? OFFSET ?`,
      )
      .all(
        input.bookId,
        input.versionId,
        input.requirePublic ? 1 : 0,
        input.query.normalized,
        input.limit,
        input.offset,
      ) as ShortResultRow[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          blockId: row.block_id,
          bookId: input.bookId,
          href: `/read/${input.bookKey}/${row.page_id}#${row.block_id}`,
          kind: row.kind,
          pageId: row.page_id,
          snippet: textSnippet(row.normalized_text, input.query.normalized),
          title: row.title.slice(0, 500),
        }),
      ),
    );
  }
}
