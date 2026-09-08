import type Database from "better-sqlite3";

import type {
  BookVersionPresentation,
  BookVersionPresentationRemover,
  BookVersionPresentationWriter,
} from "../../application/catalog-api";

interface PresentationRow {
  alias: string | null;
  book_id: number;
  source_updated_at: number;
  cover_resource_id: string | null;
  created_at: number;
  first_page_alias: string | null;
  first_page_id: number;
  metadata_json: string;
  projection_schema_version: number;
  projection_sha256: string;
  title: string;
  toc_entry_count: number;
  toc_preview_json: string;
  version_id: string;
}

function mapPresentation(row: PresentationRow): BookVersionPresentation {
  if (row.projection_schema_version !== 3) {
    throw new Error("PRESENTATION_SCHEMA_VERSION_UNSUPPORTED");
  }
  return Object.freeze({
    alias: row.alias,
    bookId: row.book_id,
    sourceUpdatedAt: row.source_updated_at,
    coverResourceId: row.cover_resource_id,
    createdAtMs: row.created_at,
    firstPageAlias: row.first_page_alias,
    firstPageId: row.first_page_id,
    metadataJson: row.metadata_json,
    projectionSchemaVersion: 3,
    projectionSha256: row.projection_sha256,
    title: row.title,
    tocEntryCount: row.toc_entry_count,
    tocPreviewJson: row.toc_preview_json,
    versionId: row.version_id,
  });
}

export class BookPresentationRepository
  implements BookVersionPresentationRemover, BookVersionPresentationWriter
{
  constructor(private readonly database: Database.Database) {}

  insert(presentation: BookVersionPresentation): BookVersionPresentation {
    const changed = this.database
      .prepare(
        `INSERT INTO book_version_presentations (
          version_id, book_id, source_updated_at, projection_schema_version,
          alias, title, metadata_json, cover_resource_id, first_page_id,
          first_page_alias, toc_preview_json, toc_entry_count,
          projection_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        presentation.versionId,
        presentation.bookId,
        presentation.sourceUpdatedAt,
        presentation.projectionSchemaVersion,
        presentation.alias,
        presentation.title,
        presentation.metadataJson,
        presentation.coverResourceId,
        presentation.firstPageId,
        presentation.firstPageAlias,
        presentation.tocPreviewJson,
        presentation.tocEntryCount,
        presentation.projectionSha256,
        presentation.createdAtMs,
      );
    if (changed.changes !== 1) throw new Error("PRESENTATION_INSERT_FAILED");
    return this.require(presentation.versionId);
  }

  find(versionId: string): BookVersionPresentation | null {
    const row = this.database
      .prepare("SELECT * FROM book_version_presentations WHERE version_id = ?")
      .get(versionId) as PresentationRow | undefined;
    return row ? mapPresentation(row) : null;
  }

  require(versionId: string): BookVersionPresentation {
    const presentation = this.find(versionId);
    if (!presentation) throw new Error("BOOK_PRESENTATION_NOT_FOUND");
    return presentation;
  }

  requireCurrentForBook(bookId: number): BookVersionPresentation {
    const row = this.database
      .prepare(
        `SELECT presentation.*
         FROM books
         JOIN book_version_presentations AS presentation
           ON presentation.version_id = books.current_version_id
          AND presentation.book_id = books.id
         WHERE books.id = ?
           AND books.deletion_requested_at IS NULL`,
      )
      .get(bookId) as PresentationRow | undefined;
    if (!row) throw new Error("CURRENT_BOOK_PRESENTATION_NOT_FOUND");
    return mapPresentation(row);
  }

  delete(versionId: string): boolean {
    return (
      this.database
        .prepare("DELETE FROM book_version_presentations WHERE version_id = ?")
        .run(versionId).changes === 1
    );
  }

  repairCurrentAliases(input: {
    readonly excludedVersionIds: readonly string[];
    readonly nowMs: number;
  }): readonly number[] {
    const excluded = new Set(input.excludedVersionIds);
    const rows = this.database
      .prepare(
        `SELECT books.id, books.alias, books.current_version_id,
                presentation.alias AS presentation_alias
         FROM books
         JOIN book_version_presentations AS presentation
           ON presentation.version_id = books.current_version_id
          AND presentation.book_id = books.id
         WHERE books.current_version_id IS NOT NULL
           AND books.deletion_requested_at IS NULL
         ORDER BY books.id`,
      )
      .all() as {
      alias: string | null;
      current_version_id: string;
      id: number;
      presentation_alias: string | null;
    }[];
    const repaired: number[] = [];
    const update = this.database.prepare(
      `UPDATE books SET alias = ?, updated_at = ?
       WHERE id = ? AND current_version_id = ?
         AND deletion_requested_at IS NULL`,
    );
    for (const row of rows) {
      if (
        excluded.has(row.current_version_id) ||
        row.alias === row.presentation_alias
      ) {
        continue;
      }
      if (
        update.run(
          row.presentation_alias,
          input.nowMs,
          row.id,
          row.current_version_id,
        ).changes === 1
      ) {
        repaired.push(row.id);
      }
    }
    return Object.freeze(repaired);
  }
}
