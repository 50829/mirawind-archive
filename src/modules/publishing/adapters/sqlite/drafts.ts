import type Database from "better-sqlite3";

import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export type BookVisibility = "draft" | "private" | "public";

interface BookRow {
  alias: string | null;
  created_at: number;
  current_candidate_id: string | null;
  current_version_id: string | null;
  draft_config_revision: number | null;
  draft_source_id: string | null;
  id: number;
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

export interface BookRecord {
  readonly alias: string | null;
  readonly createdAtMs: number;
  readonly currentCandidateId: string | null;
  readonly currentVersionId: string | null;
  readonly draftConfigRevision: number | null;
  readonly draftSourceId: string | null;
  readonly id: number;
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

function mapBook(row: BookRow): BookRecord {
  return Object.freeze({
    alias: row.alias,
    createdAtMs: row.created_at,
    currentCandidateId: row.current_candidate_id,
    currentVersionId: row.current_version_id,
    draftConfigRevision: row.draft_config_revision,
    draftSourceId: row.draft_source_id,
    id: row.id,
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
          draft_config_revision, current_candidate_id, current_version_id,
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
           WHERE id = ? AND deletion_requested_at IS NULL
             AND (draft_config_revision IS NULL OR draft_config_revision < ?)`,
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
}
