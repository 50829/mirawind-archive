import type Database from "better-sqlite3";

import type { BookVersionPresentation } from "../../services/book-presentation.js";
import type { BookVersionRecord } from "./versions.js";

interface PresentationRow {
  alias: string | null;
  book_id: number;
  config_revision: number;
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

interface CandidateRow {
  book_id: number;
  compiler_version: string;
  complete_at: number;
  config_revision: number;
  created_by_job_id: string;
  id: string;
  manifest_schema_version: number;
  manifest_sha256: string;
  predecessor_version_id: string | null;
  published_at: number | null;
  reclaimed_at: number | null;
  renderer_version: string;
  source_id: string;
  state: BookVersionRecord["state"];
  verified_at: number | null;
  version_rel_path: string;
}

function mapPresentation(row: PresentationRow): BookVersionPresentation {
  if (row.projection_schema_version !== 1) {
    throw new Error("PRESENTATION_SCHEMA_VERSION_UNSUPPORTED");
  }
  return Object.freeze({
    alias: row.alias,
    bookId: row.book_id,
    configRevision: row.config_revision,
    coverResourceId: row.cover_resource_id,
    createdAtMs: row.created_at,
    firstPageAlias: row.first_page_alias,
    firstPageId: row.first_page_id,
    metadataJson: row.metadata_json,
    projectionSchemaVersion: 1,
    projectionSha256: row.projection_sha256,
    title: row.title,
    tocEntryCount: row.toc_entry_count,
    tocPreviewJson: row.toc_preview_json,
    versionId: row.version_id,
  });
}

function mapCandidate(row: CandidateRow): BookVersionRecord {
  return Object.freeze({
    bookId: row.book_id,
    compilerVersion: row.compiler_version,
    completeAtMs: row.complete_at,
    configRevision: row.config_revision,
    createdByJobId: row.created_by_job_id,
    id: row.id,
    manifestSchemaVersion: row.manifest_schema_version,
    manifestSha256: row.manifest_sha256,
    predecessorVersionId: row.predecessor_version_id,
    publishedAtMs: row.published_at,
    reclaimedAtMs: row.reclaimed_at,
    rendererVersion: row.renderer_version,
    sourceId: row.source_id,
    state: row.state,
    verifiedAtMs: row.verified_at,
    versionRelativePath: row.version_rel_path,
  });
}

export class BookPresentationRepository {
  constructor(private readonly database: Database.Database) {}

  insert(presentation: BookVersionPresentation): BookVersionPresentation {
    const changed = this.database
      .prepare(
        `INSERT INTO book_version_presentations (
          version_id, book_id, config_revision, projection_schema_version,
          alias, title, metadata_json, cover_resource_id, first_page_id,
          first_page_alias, toc_preview_json, toc_entry_count,
          projection_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        presentation.versionId,
        presentation.bookId,
        presentation.configRevision,
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
         WHERE books.id = ?`,
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

  listReconciliationCandidates(): readonly BookVersionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT *
         FROM book_versions
         WHERE reclaimed_at IS NULL
           AND state IN ('ready', 'published', 'superseded')
         ORDER BY book_id, complete_at, id`,
      )
      .all() as CandidateRow[];
    return Object.freeze(rows.map(mapCandidate));
  }
}
