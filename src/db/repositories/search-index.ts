import type Database from "better-sqlite3";

import type {
  SearchFtsRow,
  SearchShortRow,
  SearchSpool,
} from "../../compiler/search/build-spool.js";

function requireSequentialOrdinals(
  rows: readonly { readonly ordinal: number }[],
): void {
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]?.ordinal !== index) {
      throw new Error("SEARCH_ORDINAL_INVALID");
    }
  }
}

function requireExactBlockIds(
  actual: readonly string[],
  expected: readonly string[],
): void {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  if (
    left.length !== actual.length ||
    left.length !== right.length ||
    left.some((value, index) => value !== right[index])
  ) {
    throw new Error("SEARCH_BLOCK_ID_SET_MISMATCH");
  }
}

export class SearchIndexRepository {
  constructor(private readonly database: Database.Database) {}

  insertAndValidate(input: {
    readonly expectedBlockIds: readonly string[];
    readonly spool: SearchSpool;
  }): void {
    if (
      input.spool.ftsRows.length > 1_000_000 ||
      input.spool.shortRows.length > 100_000
    ) {
      throw new Error("SEARCH_ROW_LIMIT");
    }
    requireSequentialOrdinals(input.spool.ftsRows);
    requireSequentialOrdinals(input.spool.shortRows);
    requireExactBlockIds(
      input.spool.ftsRows.map((row) => row.blockId),
      input.expectedBlockIds,
    );
    const versionIds = new Set([
      ...input.spool.ftsRows.map((row) => row.versionId),
      ...input.spool.shortRows.map((row) => row.versionId),
    ]);
    if (versionIds.size !== 1) throw new Error("SEARCH_VERSION_MISMATCH");

    const insertFts = this.database.prepare(
      `INSERT INTO search_fts (
        title, authors, heading, body, book_id, version_id,
        page_id, block_id, kind, ordinal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of input.spool.ftsRows) {
      this.insertFtsRow(insertFts, row);
    }
    const insertShort = this.database.prepare(
      `INSERT INTO search_short_fields (
        book_id, version_id, page_id, block_id,
        kind, normalized_text, ordinal
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of input.spool.shortRows) {
      this.insertShortRow(insertShort, row);
    }

    const versionId = input.spool.ftsRows[0]?.versionId;
    if (!versionId) throw new Error("SEARCH_ROWS_EMPTY");
    const stored = this.database
      .prepare(
        `SELECT block_id FROM search_fts
         WHERE version_id = ?
         ORDER BY CAST(ordinal AS INTEGER)`,
      )
      .all(versionId) as { block_id: string }[];
    requireExactBlockIds(
      stored.map((row) => row.block_id),
      input.expectedBlockIds,
    );
    const shortCount = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM search_short_fields WHERE version_id = ?",
      )
      .get(versionId) as { count: number };
    if (shortCount.count !== input.spool.shortRows.length) {
      throw new Error("SEARCH_SHORT_COUNT_MISMATCH");
    }
  }

  private insertFtsRow(statement: Database.Statement, row: SearchFtsRow): void {
    statement.run(
      row.title,
      row.authors,
      row.heading,
      row.body,
      row.bookId,
      row.versionId,
      row.pageId,
      row.blockId,
      row.kind,
      row.ordinal,
    );
  }

  private insertShortRow(
    statement: Database.Statement,
    row: SearchShortRow,
  ): void {
    statement.run(
      row.bookId,
      row.versionId,
      row.pageId,
      row.blockId,
      row.kind,
      row.normalizedText,
      row.ordinal,
    );
  }
}
