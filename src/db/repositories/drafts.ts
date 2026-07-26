import type Database from "better-sqlite3";

import { createOpaqueId } from "../../domain/ids.js";
import { withImmediateTransaction } from "../transaction/immediate.js";

export type BookVisibility = "draft" | "private" | "public";
export type DraftPreviewState = "building" | "failed" | "ready";

interface BookRow {
  alias: string | null;
  created_at: number;
  current_version_id: string | null;
  draft_config_revision: number | null;
  draft_source_id: string | null;
  id: number;
  ready_preview_revision: number | null;
  title_cache: string;
  unavailable_reason: string | null;
  updated_at: number;
  visibility: BookVisibility;
}

interface ConfigRow {
  book_id: number;
  created_at: number;
  revision: number;
  schema_version: number;
  source_id: string;
  yaml_rel_path: string;
  yaml_sha256: string;
}

interface PreviewRow {
  book_id: number;
  completed_at: number | null;
  config_revision: number;
  created_by_job_id: string;
  diagnostics_rel_path: string | null;
  preview_rel_path: string | null;
  source_id: string;
  state: DraftPreviewState;
}

export interface BookRecord {
  readonly alias: string | null;
  readonly createdAtMs: number;
  readonly currentVersionId: string | null;
  readonly draftConfigRevision: number | null;
  readonly draftSourceId: string | null;
  readonly id: number;
  readonly readyPreviewRevision: number | null;
  readonly title: string;
  readonly unavailableReason: string | null;
  readonly updatedAtMs: number;
  readonly visibility: BookVisibility;
}

export interface ConfigRevisionRecord {
  readonly bookId: number;
  readonly createdAtMs: number;
  readonly revision: number;
  readonly schemaVersion: number;
  readonly sourceId: string;
  readonly yamlRelativePath: string;
  readonly yamlSha256: string;
}

export interface DraftPreviewRecord {
  readonly bookId: number;
  readonly completedAtMs: number | null;
  readonly configRevision: number;
  readonly createdByJobId: string;
  readonly diagnosticsRelativePath: string | null;
  readonly previewRelativePath: string | null;
  readonly sourceId: string;
  readonly state: DraftPreviewState;
}

function mapBook(row: BookRow): BookRecord {
  return Object.freeze({
    alias: row.alias,
    createdAtMs: row.created_at,
    currentVersionId: row.current_version_id,
    draftConfigRevision: row.draft_config_revision,
    draftSourceId: row.draft_source_id,
    id: row.id,
    readyPreviewRevision: row.ready_preview_revision,
    title: row.title_cache,
    unavailableReason: row.unavailable_reason,
    updatedAtMs: row.updated_at,
    visibility: row.visibility,
  });
}

function mapConfig(row: ConfigRow): ConfigRevisionRecord {
  return Object.freeze({
    bookId: row.book_id,
    createdAtMs: row.created_at,
    revision: row.revision,
    schemaVersion: row.schema_version,
    sourceId: row.source_id,
    yamlRelativePath: row.yaml_rel_path,
    yamlSha256: row.yaml_sha256,
  });
}

function mapPreview(row: PreviewRow): DraftPreviewRecord {
  return Object.freeze({
    bookId: row.book_id,
    completedAtMs: row.completed_at,
    configRevision: row.config_revision,
    createdByJobId: row.created_by_job_id,
    diagnosticsRelativePath: row.diagnostics_rel_path,
    previewRelativePath: row.preview_rel_path,
    sourceId: row.source_id,
    state: row.state,
  });
}

function validateSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("SHA256_INVALID");
}

export class DraftRepository {
  constructor(private readonly database: Database.Database) {}

  createBook(input: {
    readonly nowMs: number;
    readonly title: string;
  }): BookRecord {
    const result = this.database
      .prepare(
        `INSERT INTO books (
          alias, visibility, title_cache, draft_source_id,
          draft_config_revision, ready_preview_revision, current_version_id,
          unavailable_reason, created_at, updated_at
        ) VALUES (NULL, 'draft', ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(input.title, input.nowMs, input.nowMs);
    return this.requireBook(Number(result.lastInsertRowid));
  }

  findBook(bookId: number): BookRecord | null {
    const row = this.database
      .prepare(
        "SELECT * FROM books WHERE id = ? AND deletion_requested_at IS NULL",
      )
      .get(bookId) as BookRow | undefined;
    return row ? mapBook(row) : null;
  }

  requireBook(bookId: number): BookRecord {
    const book = this.findBook(bookId);
    if (!book) throw new Error("BOOK_NOT_FOUND");
    return book;
  }

  addConfigRevision(input: {
    readonly alias?: string;
    readonly bookId: number;
    readonly nowMs: number;
    readonly revision: number;
    readonly schemaVersion: number;
    readonly sourceId: string;
    readonly title: string;
    readonly yamlRelativePath: string;
    readonly yamlSha256: string;
  }): ConfigRevisionRecord {
    validateSha256(input.yamlSha256);
    return withImmediateTransaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO config_revisions (
            book_id, revision, source_id, schema_version,
            yaml_rel_path, yaml_sha256, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.bookId,
          input.revision,
          input.sourceId,
          input.schemaVersion,
          input.yamlRelativePath,
          input.yamlSha256,
          input.nowMs,
        );
      const changed = this.database
        .prepare(
          `UPDATE books
           SET draft_source_id = ?, draft_config_revision = ?,
               title_cache = ?, updated_at = ?
           WHERE id = ?
             AND deletion_requested_at IS NULL
             AND (
               draft_config_revision IS NULL
               OR draft_config_revision < ?
             )`,
        )
        .run(
          input.sourceId,
          input.revision,
          input.title,
          input.nowMs,
          input.bookId,
          input.revision,
        );
      if (changed.changes !== 1) throw new Error("CONFIG_REVISION_CONFLICT");
      return this.requireConfig(input.bookId, input.revision);
    });
  }

  replaceConfigAndQueuePreview(input: {
    readonly alias: string | null;
    readonly bookId: number;
    readonly expectedRevision: number;
    readonly expectedYamlSha256: string;
    readonly nowMs: number;
    readonly revision: number;
    readonly schemaVersion: number;
    readonly sourceId: string;
    readonly title: string;
    readonly yamlRelativePath: string;
    readonly yamlSha256: string;
  }): {
    readonly config: ConfigRevisionRecord;
    readonly jobId: string;
    readonly preview: DraftPreviewRecord;
  } {
    validateSha256(input.expectedYamlSha256);
    validateSha256(input.yamlSha256);
    if (input.revision !== input.expectedRevision + 1) {
      throw new Error("CONFIG_REVISION_SEQUENCE_INVALID");
    }
    return withImmediateTransaction(this.database, () => {
      const current = this.database
        .prepare(
          `SELECT books.draft_config_revision AS revision,
                  books.draft_source_id AS source_id,
                  config_revisions.yaml_sha256 AS yaml_sha256
           FROM books
           JOIN config_revisions
             ON config_revisions.book_id = books.id
            AND config_revisions.revision = books.draft_config_revision
           WHERE books.id = ?
             AND books.deletion_requested_at IS NULL`,
        )
        .get(input.bookId) as
        | {
            revision: number;
            source_id: string;
            yaml_sha256: string;
          }
        | undefined;
      if (
        !current ||
        current.revision !== input.expectedRevision ||
        current.source_id !== input.sourceId ||
        current.yaml_sha256 !== input.expectedYamlSha256
      ) {
        throw new Error("CONFIG_REVISION_CONFLICT");
      }
      this.database
        .prepare(
          `INSERT INTO config_revisions (
            book_id, revision, source_id, schema_version,
            yaml_rel_path, yaml_sha256, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.bookId,
          input.revision,
          input.sourceId,
          input.schemaVersion,
          input.yamlRelativePath,
          input.yamlSha256,
          input.nowMs,
        );
      const changed = this.database
        .prepare(
          `UPDATE books
           SET draft_config_revision = ?, title_cache = ?, updated_at = ?
           WHERE id = ? AND draft_config_revision = ? AND draft_source_id = ?
             AND deletion_requested_at IS NULL`,
        )
        .run(
          input.revision,
          input.title,
          input.nowMs,
          input.bookId,
          input.expectedRevision,
          input.sourceId,
        );
      if (changed.changes !== 1) throw new Error("CONFIG_REVISION_CONFLICT");

      const jobId = createOpaqueId("job");
      this.database
        .prepare(
          `INSERT INTO jobs (
            id, kind, state, import_id, book_id, version_id,
            captured_source_id, captured_config_revision,
            captured_current_version_id, retry_of_job_id, attempt,
            automatic_retry_count, lease_owner, lease_until, heartbeat_at,
            phase, progress_json, error_code, error_class, error_detail_json,
            cancellation_requested_at, created_at, started_at, finished_at
          ) VALUES (
            ?, 'build_preview', 'queued', NULL, ?, NULL, ?, ?, NULL, NULL, 1,
            0, NULL, NULL, NULL, 'queued', '{}', NULL, NULL, NULL,
            NULL, ?, NULL, NULL
          )`,
        )
        .run(jobId, input.bookId, input.sourceId, input.revision, input.nowMs);
      this.database
        .prepare(
          `INSERT INTO draft_previews (
            book_id, config_revision, source_id, state, preview_rel_path,
            diagnostics_rel_path, created_by_job_id, completed_at
          ) VALUES (?, ?, ?, 'building', NULL, NULL, ?, NULL)`,
        )
        .run(input.bookId, input.revision, input.sourceId, jobId);
      return Object.freeze({
        config: this.requireConfig(input.bookId, input.revision),
        jobId,
        preview: this.requirePreview(input.bookId, input.revision),
      });
    });
  }

  replaceSourceConfigAndQueuePreview(input: {
    readonly bookId: number;
    readonly expectedRevision: number;
    readonly expectedSourceId: string;
    readonly expectedYamlSha256: string;
    readonly importId: string;
    readonly newSourceId: string;
    readonly nowMs: number;
    readonly revision: number;
    readonly schemaVersion: number;
    readonly title: string;
    readonly yamlRelativePath: string;
    readonly yamlSha256: string;
  }): {
    readonly config: ConfigRevisionRecord;
    readonly jobId: string;
    readonly preview: DraftPreviewRecord;
  } {
    validateSha256(input.expectedYamlSha256);
    validateSha256(input.yamlSha256);
    if (input.revision !== input.expectedRevision + 1) {
      throw new Error("CONFIG_REVISION_SEQUENCE_INVALID");
    }
    return withImmediateTransaction(this.database, () => {
      const current = this.database
        .prepare(
          `SELECT books.draft_config_revision AS revision,
                  books.draft_source_id AS source_id,
                  config_revisions.yaml_sha256 AS yaml_sha256
           FROM books
           JOIN config_revisions
             ON config_revisions.book_id = books.id
            AND config_revisions.revision = books.draft_config_revision
           WHERE books.id = ?
             AND books.deletion_requested_at IS NULL`,
        )
        .get(input.bookId) as
        | {
            revision: number;
            source_id: string;
            yaml_sha256: string;
          }
        | undefined;
      if (
        !current ||
        current.revision !== input.expectedRevision ||
        current.source_id !== input.expectedSourceId ||
        current.yaml_sha256 !== input.expectedYamlSha256
      ) {
        throw new Error("CONFIG_REVISION_CONFLICT");
      }
      this.database
        .prepare(
          `INSERT INTO config_revisions (
            book_id, revision, source_id, schema_version,
            yaml_rel_path, yaml_sha256, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.bookId,
          input.revision,
          input.newSourceId,
          input.schemaVersion,
          input.yamlRelativePath,
          input.yamlSha256,
          input.nowMs,
        );
      const changed = this.database
        .prepare(
          `UPDATE books
           SET draft_source_id = ?, draft_config_revision = ?,
               ready_preview_revision = NULL, title_cache = ?, updated_at = ?
           WHERE id = ? AND draft_config_revision = ? AND draft_source_id = ?
             AND deletion_requested_at IS NULL`,
        )
        .run(
          input.newSourceId,
          input.revision,
          input.title,
          input.nowMs,
          input.bookId,
          input.expectedRevision,
          input.expectedSourceId,
        );
      if (changed.changes !== 1) throw new Error("CONFIG_REVISION_CONFLICT");

      const jobId = createOpaqueId("job");
      this.database
        .prepare(
          `INSERT INTO jobs (
            id, kind, state, import_id, book_id, version_id,
            captured_source_id, captured_config_revision,
            captured_current_version_id, retry_of_job_id, attempt,
            automatic_retry_count, lease_owner, lease_until, heartbeat_at,
            phase, progress_json, error_code, error_class, error_detail_json,
            cancellation_requested_at, created_at, started_at, finished_at
          ) VALUES (
            ?, 'build_preview', 'queued', ?, ?, NULL, ?, ?, NULL, NULL, 1,
            0, NULL, NULL, NULL, 'queued', '{}', NULL, NULL, NULL,
            NULL, ?, NULL, NULL
          )`,
        )
        .run(
          jobId,
          input.importId,
          input.bookId,
          input.newSourceId,
          input.revision,
          input.nowMs,
        );
      this.database
        .prepare(
          `INSERT INTO draft_previews (
            book_id, config_revision, source_id, state, preview_rel_path,
            diagnostics_rel_path, created_by_job_id, completed_at
          ) VALUES (?, ?, ?, 'building', NULL, NULL, ?, NULL)`,
        )
        .run(input.bookId, input.revision, input.newSourceId, jobId);
      return Object.freeze({
        config: this.requireConfig(input.bookId, input.revision),
        jobId,
        preview: this.requirePreview(input.bookId, input.revision),
      });
    });
  }

  findConfig(bookId: number, revision: number): ConfigRevisionRecord | null {
    const row = this.database
      .prepare(
        "SELECT * FROM config_revisions WHERE book_id = ? AND revision = ?",
      )
      .get(bookId, revision) as ConfigRow | undefined;
    return row ? mapConfig(row) : null;
  }

  requireConfig(bookId: number, revision: number): ConfigRevisionRecord {
    const config = this.findConfig(bookId, revision);
    if (!config) throw new Error("CONFIG_REVISION_NOT_FOUND");
    return config;
  }

  createPreview(input: {
    readonly bookId: number;
    readonly configRevision: number;
    readonly jobId: string;
    readonly sourceId: string;
  }): DraftPreviewRecord {
    this.database
      .prepare(
        `INSERT INTO draft_previews (
          book_id, config_revision, source_id, state, preview_rel_path,
          diagnostics_rel_path, created_by_job_id, completed_at
        ) VALUES (?, ?, ?, 'building', NULL, NULL, ?, NULL)`,
      )
      .run(input.bookId, input.configRevision, input.sourceId, input.jobId);
    return this.requirePreview(input.bookId, input.configRevision);
  }

  completePreview(input: {
    readonly bookId: number;
    readonly configRevision: number;
    readonly diagnosticsRelativePath: string;
    readonly nowMs: number;
    readonly previewRelativePath: string;
  }): DraftPreviewRecord {
    return withImmediateTransaction(this.database, () => {
      const changed = this.database
        .prepare(
          `UPDATE draft_previews
           SET state = 'ready', preview_rel_path = ?,
               diagnostics_rel_path = ?, completed_at = ?
           WHERE book_id = ? AND config_revision = ? AND state = 'building'`,
        )
        .run(
          input.previewRelativePath,
          input.diagnosticsRelativePath,
          input.nowMs,
          input.bookId,
          input.configRevision,
        );
      if (changed.changes !== 1) throw new Error("PREVIEW_STATE_CONFLICT");
      this.database
        .prepare(
          `UPDATE books
           SET ready_preview_revision = ?, updated_at = ?
           WHERE id = ? AND draft_config_revision = ?
             AND deletion_requested_at IS NULL`,
        )
        .run(
          input.configRevision,
          input.nowMs,
          input.bookId,
          input.configRevision,
        );
      return this.requirePreview(input.bookId, input.configRevision);
    });
  }

  findPreview(
    bookId: number,
    configRevision: number,
  ): DraftPreviewRecord | null {
    const row = this.database
      .prepare(
        `SELECT * FROM draft_previews
         WHERE book_id = ? AND config_revision = ?`,
      )
      .get(bookId, configRevision) as PreviewRow | undefined;
    return row ? mapPreview(row) : null;
  }

  requirePreview(bookId: number, configRevision: number): DraftPreviewRecord {
    const preview = this.findPreview(bookId, configRevision);
    if (!preview) throw new Error("DRAFT_PREVIEW_NOT_FOUND");
    return preview;
  }
}
