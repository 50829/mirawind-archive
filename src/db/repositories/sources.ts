import type Database from "better-sqlite3";

import { createOpaqueId } from "../../domain/ids.js";

interface SourceRow {
  analysis_version: string;
  book_id: number;
  created_at: number;
  created_from_import_id: string;
  id: string;
  main_markdown_path: string;
  main_markdown_sha256: string;
  source_root_rel_path: string;
}

interface OriginalRow {
  book_id: number;
  created_at: number;
  id: string;
  media_type: string;
  original_name: string;
  role: "mineru_zip";
  sha256: string;
  size_bytes: number;
  source_id: string;
  storage_rel_path: string;
}

export interface SourceSnapshotRecord {
  readonly analysisVersion: string;
  readonly bookId: number;
  readonly createdAtMs: number;
  readonly createdFromImportId: string;
  readonly id: string;
  readonly mainMarkdownPath: string;
  readonly mainMarkdownSha256: string;
  readonly sourceRootRelativePath: string;
}

export interface OriginalFileRecord {
  readonly bookId: number;
  readonly createdAtMs: number;
  readonly id: string;
  readonly mediaType: string;
  readonly originalName: string;
  readonly role: "mineru_zip";
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly sourceId: string;
  readonly storageRelativePath: string;
}

function mapSource(row: SourceRow): SourceSnapshotRecord {
  return Object.freeze({
    analysisVersion: row.analysis_version,
    bookId: row.book_id,
    createdAtMs: row.created_at,
    createdFromImportId: row.created_from_import_id,
    id: row.id,
    mainMarkdownPath: row.main_markdown_path,
    mainMarkdownSha256: row.main_markdown_sha256,
    sourceRootRelativePath: row.source_root_rel_path,
  });
}

function mapOriginal(row: OriginalRow): OriginalFileRecord {
  return Object.freeze({
    bookId: row.book_id,
    createdAtMs: row.created_at,
    id: row.id,
    mediaType: row.media_type,
    originalName: row.original_name,
    role: row.role,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    sourceId: row.source_id,
    storageRelativePath: row.storage_rel_path,
  });
}

function validateSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("SHA256_INVALID");
}

export class SourceRepository {
  constructor(private readonly database: Database.Database) {}

  createSnapshot(input: {
    readonly analysisVersion: string;
    readonly bookId: number;
    readonly createdFromImportId: string;
    readonly id?: string;
    readonly mainMarkdownPath: string;
    readonly mainMarkdownSha256: string;
    readonly nowMs: number;
    readonly sourceRootRelativePath: string;
  }): SourceSnapshotRecord {
    validateSha256(input.mainMarkdownSha256);
    const id = input.id ?? createOpaqueId("source");
    this.database
      .prepare(
        `INSERT INTO source_snapshots (
          id, book_id, main_markdown_path, main_markdown_sha256,
          source_root_rel_path, analysis_version, created_from_import_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.bookId,
        input.mainMarkdownPath,
        input.mainMarkdownSha256,
        input.sourceRootRelativePath,
        input.analysisVersion,
        input.createdFromImportId,
        input.nowMs,
      );
    return this.requireSnapshot(id);
  }

  findSnapshot(id: string): SourceSnapshotRecord | null {
    const row = this.database
      .prepare("SELECT * FROM source_snapshots WHERE id = ?")
      .get(id) as SourceRow | undefined;
    return row ? mapSource(row) : null;
  }

  requireSnapshot(id: string): SourceSnapshotRecord {
    const source = this.findSnapshot(id);
    if (!source) throw new Error("SOURCE_SNAPSHOT_NOT_FOUND");
    return source;
  }

  registerOriginal(input: {
    readonly bookId: number;
    readonly id?: string;
    readonly mediaType: string;
    readonly nowMs: number;
    readonly originalName: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly sourceId: string;
    readonly storageRelativePath: string;
  }): OriginalFileRecord {
    validateSha256(input.sha256);
    const id = input.id ?? createOpaqueId("file");
    this.database
      .prepare(
        `INSERT INTO original_files (
          id, book_id, source_id, role, storage_rel_path, original_name,
          media_type, size_bytes, sha256, created_at
        ) VALUES (?, ?, ?, 'mineru_zip', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.bookId,
        input.sourceId,
        input.storageRelativePath,
        input.originalName,
        input.mediaType,
        input.sizeBytes,
        input.sha256,
        input.nowMs,
      );
    return this.requireOriginal(id);
  }

  findOriginal(id: string): OriginalFileRecord | null {
    const row = this.database
      .prepare("SELECT * FROM original_files WHERE id = ?")
      .get(id) as OriginalRow | undefined;
    return row ? mapOriginal(row) : null;
  }

  requireOriginal(id: string): OriginalFileRecord {
    const original = this.findOriginal(id);
    if (!original) throw new Error("ORIGINAL_FILE_NOT_FOUND");
    return original;
  }
}
