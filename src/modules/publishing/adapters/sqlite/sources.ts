import type Database from "better-sqlite3";

import { createOpaqueId } from "@/domain/ids";

interface SourceRow {
  analysis_version: string;
  book_id: number;
  created_at: number;
  created_from_import_id: string | null;
  id: string;
  main_markdown_path: string;
  main_markdown_sha256: string;
  origin: SourceOrigin;
  parent_source_id: string | null;
  source_root_rel_path: string;
}

interface SourceAssetRow {
  book_id: number;
  created_at: number;
  id: string;
  sha256: string;
  size_bytes: number;
  storage_rel_path: string;
}

interface SourceAssetBindingRow extends SourceAssetRow {
  logical_path: string;
  source_id: string;
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
  readonly createdFromImportId: string | null;
  readonly id: string;
  readonly mainMarkdownPath: string;
  readonly mainMarkdownSha256: string;
  readonly origin: SourceOrigin;
  readonly parentSourceId: string | null;
  readonly sourceRootRelativePath: string;
}

export type SourceOrigin = "edit" | "import";

export interface SourceAssetRecord {
  readonly bookId: number;
  readonly createdAtMs: number;
  readonly id: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly storageRelativePath: string;
}

export interface SourceAssetBindingRecord extends SourceAssetRecord {
  readonly logicalPath: string;
  readonly sourceId: string;
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
    origin: row.origin,
    parentSourceId: row.parent_source_id,
    sourceRootRelativePath: row.source_root_rel_path,
  });
}

function mapAsset(row: SourceAssetRow): SourceAssetRecord {
  return Object.freeze({
    bookId: row.book_id,
    createdAtMs: row.created_at,
    id: row.id,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    storageRelativePath: row.storage_rel_path,
  });
}

function mapBinding(row: SourceAssetBindingRow): SourceAssetBindingRecord {
  return Object.freeze({
    ...mapAsset(row),
    logicalPath: row.logical_path,
    sourceId: row.source_id,
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

function validateLogicalPath(value: string): void {
  if (
    value.length < 1 ||
    Buffer.byteLength(value, "utf8") > 2_048 ||
    value !== value.normalize("NFC") ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("SOURCE_ASSET_LOGICAL_PATH_INVALID");
  }
}

type CreateSourceSnapshotInput = {
  readonly analysisVersion: string;
  readonly bookId: number;
  readonly id?: string;
  readonly mainMarkdownPath: string;
  readonly mainMarkdownSha256: string;
  readonly nowMs: number;
  readonly sourceRootRelativePath: string;
} & (
  | {
      readonly createdFromImportId: string;
      readonly origin: "import";
    }
  | {
      readonly origin: "edit";
      readonly parentSourceId: string;
    }
);

export class SourceRepository {
  constructor(private readonly database: Database.Database) {}

  createSnapshot(input: CreateSourceSnapshotInput): SourceSnapshotRecord {
    validateSha256(input.mainMarkdownSha256);
    const id = input.id ?? createOpaqueId("source");
    this.database
      .prepare(
        `INSERT INTO source_snapshots (
          id, book_id, main_markdown_path, main_markdown_sha256,
          source_root_rel_path, analysis_version, origin, parent_source_id,
          created_from_import_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.bookId,
        input.mainMarkdownPath,
        input.mainMarkdownSha256,
        input.sourceRootRelativePath,
        input.analysisVersion,
        input.origin,
        input.origin === "edit" ? input.parentSourceId : null,
        input.origin === "import" ? input.createdFromImportId : null,
        input.nowMs,
      );
    return this.requireSnapshot(id);
  }

  registerAsset(input: {
    readonly bookId: number;
    readonly id?: string;
    readonly nowMs: number;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly storageRelativePath: string;
  }): SourceAssetRecord {
    validateSha256(input.sha256);
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
      throw new Error("SOURCE_ASSET_SIZE_INVALID");
    }
    const id = input.id ?? createOpaqueId("sourceAsset");
    this.database
      .prepare(
        `INSERT INTO source_assets (
          id, book_id, storage_rel_path, size_bytes, sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.bookId,
        input.storageRelativePath,
        input.sizeBytes,
        input.sha256,
        input.nowMs,
      );
    return this.requireAsset(id);
  }

  findAsset(id: string): SourceAssetRecord | null {
    const row = this.database
      .prepare("SELECT * FROM source_assets WHERE id = ?")
      .get(id) as SourceAssetRow | undefined;
    return row ? mapAsset(row) : null;
  }

  requireAsset(id: string): SourceAssetRecord {
    const asset = this.findAsset(id);
    if (!asset) throw new Error("SOURCE_ASSET_NOT_FOUND");
    return asset;
  }

  bindAsset(input: {
    readonly assetId: string;
    readonly logicalPath: string;
    readonly sourceId: string;
  }): SourceAssetBindingRecord {
    validateLogicalPath(input.logicalPath);
    this.database
      .prepare(
        `INSERT INTO source_asset_bindings (source_id, logical_path, asset_id)
         VALUES (?, ?, ?)`,
      )
      .run(input.sourceId, input.logicalPath, input.assetId);
    const row = this.database
      .prepare(
        `SELECT binding.source_id, binding.logical_path, asset.*
         FROM source_asset_bindings AS binding
         JOIN source_assets AS asset ON asset.id = binding.asset_id
         WHERE binding.source_id = ? AND binding.logical_path = ?`,
      )
      .get(input.sourceId, input.logicalPath) as
      SourceAssetBindingRow | undefined;
    if (!row) throw new Error("SOURCE_ASSET_BINDING_NOT_FOUND");
    return mapBinding(row);
  }

  bindingsForSource(sourceId: string): readonly SourceAssetBindingRecord[] {
    const rows = this.database
      .prepare(
        `SELECT binding.source_id, binding.logical_path, asset.*
         FROM source_asset_bindings AS binding
         JOIN source_assets AS asset ON asset.id = binding.asset_id
         WHERE binding.source_id = ?
         ORDER BY binding.logical_path`,
      )
      .all(sourceId) as SourceAssetBindingRow[];
    return Object.freeze(rows.map(mapBinding));
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

  findImportOrigin(id: string): SourceSnapshotRecord | null {
    const row = this.database
      .prepare(
        `WITH RECURSIVE lineage AS (
           SELECT source.*, 0 AS depth
           FROM source_snapshots AS source
           WHERE source.id = ?
           UNION ALL
           SELECT parent.*, lineage.depth + 1
           FROM source_snapshots AS parent
           JOIN lineage ON parent.id = lineage.parent_source_id
           WHERE lineage.depth < 1000
         )
         SELECT id, book_id, main_markdown_path, main_markdown_sha256,
                source_root_rel_path, analysis_version, origin,
                parent_source_id, created_from_import_id, created_at
         FROM lineage
         WHERE origin = 'import'
         ORDER BY depth
         LIMIT 1`,
      )
      .get(id) as SourceRow | undefined;
    return row ? mapSource(row) : null;
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

  findMineruOriginal(
    bookId: number,
    sourceId: string,
  ): OriginalFileRecord | null {
    const row = this.database
      .prepare(
        `SELECT * FROM original_files
         WHERE book_id = ? AND source_id = ? AND role = 'mineru_zip'
         LIMIT 1`,
      )
      .get(bookId, sourceId) as OriginalRow | undefined;
    return row ? mapOriginal(row) : null;
  }

  requireOriginal(id: string): OriginalFileRecord {
    const original = this.findOriginal(id);
    if (!original) throw new Error("ORIGINAL_FILE_NOT_FOUND");
    return original;
  }
}
