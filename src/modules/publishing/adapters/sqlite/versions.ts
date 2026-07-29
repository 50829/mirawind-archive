import type Database from "better-sqlite3";

import type { BookVersionPresentation } from "@/modules/catalog/application/public";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import type { SearchSpool } from "@/modules/publishing/adapters/filesystem/search-spool";
import { SearchIndexRepository } from "@/modules/publishing/adapters/sqlite/search-index";
import type {
  BookVersionRecord,
  BookVersionState,
} from "@/modules/publishing/application/version-record";

interface VersionRow {
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
  state: BookVersionState;
  verified_at: number | null;
  version_rel_path: string;
}

function mapVersion(row: VersionRow): BookVersionRecord {
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

function insertPresentation(
  database: Database.Database,
  presentation: BookVersionPresentation,
): void {
  const changed = database
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
}

export class VersionRepository {
  constructor(private readonly database: Database.Database) {}

  find(versionId: string): BookVersionRecord | null {
    const row = this.database
      .prepare("SELECT * FROM book_versions WHERE id = ?")
      .get(versionId) as VersionRow | undefined;
    return row ? mapVersion(row) : null;
  }

  require(versionId: string): BookVersionRecord {
    const version = this.find(versionId);
    if (!version) throw new Error("BOOK_VERSION_NOT_FOUND");
    return version;
  }

  listForBook(bookId: number): readonly BookVersionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM book_versions
         WHERE book_id = ?
         ORDER BY complete_at DESC, id DESC`,
      )
      .all(bookId) as VersionRow[];
    return Object.freeze(rows.map(mapVersion));
  }

  listAll(): readonly BookVersionRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM book_versions ORDER BY book_id, complete_at, id")
      .all() as VersionRow[];
    return Object.freeze(rows.map(mapVersion));
  }

  markCorrupt(versionId: string): BookVersionRecord {
    const changed = this.database
      .prepare(
        `UPDATE book_versions SET state = 'corrupt'
         WHERE id = ? AND state <> 'corrupt'`,
      )
      .run(versionId);
    if (changed.changes > 1) throw new Error("VERSION_CORRUPT_UPDATE_INVALID");
    return this.require(versionId);
  }

  markVerified(versionId: string, nowMs: number): BookVersionRecord {
    const changed = this.database
      .prepare(
        `UPDATE book_versions SET verified_at = ?
         WHERE id = ? AND state <> 'corrupt'`,
      )
      .run(nowMs, versionId);
    if (changed.changes !== 1) throw new Error("VERSION_VERIFY_UPDATE_INVALID");
    return this.require(versionId);
  }

  registerReadyWithSearch(input: {
    readonly bookId: number;
    readonly compilerVersion: string;
    readonly completeAtMs: number;
    readonly configRevision: number;
    readonly createdByJobId: string;
    readonly expectedSearchBlockIds: readonly string[];
    readonly manifestSchemaVersion: number;
    readonly manifestSha256: string;
    readonly predecessorVersionId: string | null;
    readonly presentation: BookVersionPresentation;
    readonly rendererVersion: string;
    readonly sourceId: string;
    readonly spool: SearchSpool;
    readonly versionId: string;
    readonly versionRelativePath: string;
  }): BookVersionRecord {
    if (!/^[a-f0-9]{64}$/u.test(input.manifestSha256)) {
      throw new Error("MANIFEST_SHA256_INVALID");
    }
    return withImmediateTransaction(this.database, () => {
      if (
        input.presentation.versionId !== input.versionId ||
        input.presentation.bookId !== input.bookId ||
        input.presentation.configRevision !== input.configRevision ||
        input.spool.ftsRows.some(
          (row) =>
            row.bookId !== input.bookId || row.versionId !== input.versionId,
        ) ||
        input.spool.shortRows.some(
          (row) =>
            row.bookId !== input.bookId || row.versionId !== input.versionId,
        )
      ) {
        throw new Error("SEARCH_CAPTURE_MISMATCH");
      }
      this.database
        .prepare(
          `INSERT INTO book_versions (
            id, book_id, source_id, config_revision, predecessor_version_id,
            state, version_rel_path, manifest_schema_version, manifest_sha256,
            compiler_version, renderer_version, complete_at, published_at,
            verified_at, created_by_job_id
          ) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
        )
        .run(
          input.versionId,
          input.bookId,
          input.sourceId,
          input.configRevision,
          input.predecessorVersionId,
          input.versionRelativePath,
          input.manifestSchemaVersion,
          input.manifestSha256,
          input.compilerVersion,
          input.rendererVersion,
          input.completeAtMs,
          input.createdByJobId,
        );
      insertPresentation(this.database, input.presentation);
      new SearchIndexRepository(this.database).insertAndValidate({
        expectedBlockIds: input.expectedSearchBlockIds,
        spool: input.spool,
      });
      const jobUpdated = this.database
        .prepare(
          `UPDATE jobs SET version_id = ?
           WHERE id = ? AND kind = 'build_publish' AND version_id IS NULL`,
        )
        .run(input.versionId, input.createdByJobId);
      if (jobUpdated.changes !== 1) throw new Error("VERSION_JOB_MISMATCH");
      return this.require(input.versionId);
    });
  }
}
