import { readFile } from "node:fs/promises";

import type Database from "better-sqlite3";

import type { AuthorizationDecision } from "../http/authorization/admin-guard.js";
import {
  authorizeBookResource,
  type BookVisibility,
  type VersionState,
} from "../http/authorization/book-guard.js";
import { SafeApplicationError } from "../domain/errors.js";
import { isOpaqueId } from "../domain/ids.js";
import { validateDocumentManifest } from "../schemas/document-manifest.js";
import type { StorageLayout } from "../storage/layout.js";
import { resolveContainedPath } from "../storage/layout.js";

interface CurrentBookRow {
  alias: string | null;
  current_version_id: string | null;
  id: number;
  renderer_version: string | null;
  state: VersionState | null;
  title_cache: string;
  version_rel_path: string | null;
  visibility: BookVisibility;
}

interface VersionAssetRow extends CurrentBookRow {
  requested_state: VersionState | null;
  requested_version_rel_path: string | null;
}

interface OriginalRow extends CurrentBookRow {
  file_id: string | null;
  media_type: string | null;
  original_name: string | null;
  sha256: string | null;
  size_bytes: number | null;
}

interface ManifestPage {
  readonly alias?: string;
  readonly output_path: string;
  readonly page_id: number;
  readonly title: string;
}

interface ManifestResource {
  readonly media_type: string;
  readonly output_path: string;
  readonly sha256: string;
  readonly size: number;
}

interface ReaderManifest {
  readonly book_id: number;
  readonly pages: readonly ManifestPage[];
  readonly resources: Readonly<Record<string, ManifestResource>>;
  readonly version_id: string;
}

export interface ResolvedPublishedBook {
  readonly alias: string | null;
  readonly audience: "administrator" | "anonymous";
  readonly bookId: number;
  readonly rendererVersion: string;
  readonly title: string;
  readonly versionId: string;
  readonly versionRelativePath: string;
  readonly visibility: BookVisibility;
}

export interface ResolvedPublishedPage extends ResolvedPublishedBook {
  readonly pageAlias: string | null;
  readonly pageId: number;
  readonly pageRelativePath: string;
  readonly pageTitle: string;
}

export interface ResolvedPublishedAsset extends ResolvedPublishedBook {
  readonly mediaType: string;
  readonly resourceId: string;
  readonly resourceRelativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ResolvedOriginalFile extends ResolvedPublishedBook {
  readonly fileId: string;
  readonly mediaType: string;
  readonly originalName: string;
  readonly originalRelativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

const bookAliasPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const pageAliasPattern = bookAliasPattern;

function hidden(): never {
  throw new SafeApplicationError(
    "NOT_FOUND",
    "The requested resource was not found.",
    404,
  );
}

function unavailable(): never {
  throw new SafeApplicationError(
    "BOOK_UNAVAILABLE",
    "This book is temporarily unavailable.",
    503,
  );
}

function keyPredicate(bookKey: string): {
  readonly sql: "books.alias = ?" | "books.id = ?";
  readonly value: number | string;
} {
  if (/^[1-9][0-9]*$/u.test(bookKey)) {
    const id = Number(bookKey);
    if (Number.isSafeInteger(id)) return { sql: "books.id = ?", value: id };
  } else if (bookAliasPattern.test(bookKey) && bookKey.length <= 120) {
    return { sql: "books.alias = ?", value: bookKey };
  }
  return hidden();
}

function mapCurrent(
  row: CurrentBookRow,
  administrator: AuthorizationDecision,
): ResolvedPublishedBook {
  const access = authorizeBookResource({
    administrator,
    exists: true,
    visibility: row.visibility,
  });
  if (!access.allowed) return hidden();
  if (
    !row.current_version_id ||
    !row.version_rel_path ||
    !row.renderer_version ||
    row.state !== "published"
  ) {
    if (row.visibility === "public" || row.current_version_id) {
      return unavailable();
    }
    return hidden();
  }
  return Object.freeze({
    alias: row.alias,
    audience: access.audience,
    bookId: row.id,
    rendererVersion: row.renderer_version,
    title: row.title_cache,
    versionId: row.current_version_id,
    versionRelativePath: row.version_rel_path,
    visibility: row.visibility,
  });
}

function currentSelect(predicate: string): string {
  return `SELECT books.id, books.alias, books.visibility, books.title_cache,
                 books.current_version_id, book_versions.state,
                 book_versions.version_rel_path, book_versions.renderer_version
          FROM books
          LEFT JOIN book_versions
            ON book_versions.id = books.current_version_id
           AND book_versions.book_id = books.id
           AND book_versions.reclaimed_at IS NULL
          WHERE ${predicate}
          LIMIT 1`;
}

async function readManifest(
  layout: StorageLayout,
  book: ResolvedPublishedBook,
  versionRelativePath = book.versionRelativePath,
  versionId = book.versionId,
): Promise<ReaderManifest> {
  const path = await resolveContainedPath(
    layout.root,
    `${versionRelativePath}/document-manifest.json`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
    validateDocumentManifest(parsed);
  } catch {
    return unavailable();
  }
  const manifest = parsed as ReaderManifest;
  if (manifest.book_id !== book.bookId || manifest.version_id !== versionId) {
    return unavailable();
  }
  return manifest;
}

export class PublishedBookService {
  constructor(
    private readonly database: Database.Database,
    private readonly layout: StorageLayout,
  ) {}

  resolveCurrent(
    bookKey: string,
    administrator: AuthorizationDecision,
  ): ResolvedPublishedBook {
    const predicate = keyPredicate(bookKey);
    const row = this.database
      .prepare(currentSelect(predicate.sql))
      .get(predicate.value) as CurrentBookRow | undefined;
    if (!row) return hidden();
    return mapCurrent(row, administrator);
  }

  async resolvePage(input: {
    readonly administrator: AuthorizationDecision;
    readonly bookKey: string;
    readonly pageKey: string;
  }): Promise<ResolvedPublishedPage> {
    const book = this.resolveCurrent(input.bookKey, input.administrator);
    const manifest = await readManifest(this.layout, book);
    let page: ManifestPage | undefined;
    if (/^[1-9][0-9]*$/u.test(input.pageKey)) {
      const pageId = Number(input.pageKey);
      if (Number.isSafeInteger(pageId)) {
        page = manifest.pages.find((candidate) => candidate.page_id === pageId);
      }
    } else if (
      pageAliasPattern.test(input.pageKey) &&
      input.pageKey.length <= 120
    ) {
      page = manifest.pages.find(
        (candidate) => candidate.alias === input.pageKey,
      );
    }
    if (!page) return hidden();
    return Object.freeze({
      ...book,
      pageAlias: page.alias ?? null,
      pageId: page.page_id,
      pageRelativePath: `${book.versionRelativePath}/${page.output_path}`,
      pageTitle: page.title,
    });
  }

  async resolveAsset(input: {
    readonly administrator: AuthorizationDecision;
    readonly bookKey: string;
    readonly resourceId: string;
    readonly versionId: string;
  }): Promise<ResolvedPublishedAsset> {
    if (
      !isOpaqueId("version", input.versionId) ||
      !isOpaqueId("resource", input.resourceId)
    ) {
      return hidden();
    }
    const predicate = keyPredicate(input.bookKey);
    const row = this.database
      .prepare(
        `SELECT books.id, books.alias, books.visibility, books.title_cache,
                books.current_version_id, current_version.state,
                current_version.version_rel_path,
                current_version.renderer_version,
                requested_version.state AS requested_state,
                requested_version.version_rel_path AS requested_version_rel_path
         FROM books
         LEFT JOIN book_versions AS current_version
           ON current_version.id = books.current_version_id
          AND current_version.book_id = books.id
          AND current_version.reclaimed_at IS NULL
         LEFT JOIN book_versions AS requested_version
           ON requested_version.id = ?
          AND requested_version.book_id = books.id
          AND requested_version.reclaimed_at IS NULL
         WHERE ${predicate.sql}
         LIMIT 1`,
      )
      .get(input.versionId, predicate.value) as VersionAssetRow | undefined;
    if (!row) return hidden();
    const book = mapCurrent(row, input.administrator);
    const access = authorizeBookResource({
      administrator: input.administrator,
      exists: Boolean(row.requested_version_rel_path),
      ...(row.requested_state ? { versionState: row.requested_state } : {}),
      visibility: row.visibility,
    });
    if (!access.allowed || !row.requested_version_rel_path) return hidden();
    const manifest = await readManifest(
      this.layout,
      book,
      row.requested_version_rel_path,
      input.versionId,
    );
    const resource = manifest.resources[input.resourceId];
    if (!resource) return hidden();
    return Object.freeze({
      ...book,
      mediaType: resource.media_type,
      resourceId: input.resourceId,
      resourceRelativePath: `${row.requested_version_rel_path}/${resource.output_path}`,
      sha256: resource.sha256,
      sizeBytes: resource.size,
      versionId: input.versionId,
      versionRelativePath: row.requested_version_rel_path,
    });
  }

  resolveOriginal(input: {
    readonly administrator: AuthorizationDecision;
    readonly bookKey: string;
    readonly fileId: string;
  }): ResolvedOriginalFile {
    if (!isOpaqueId("file", input.fileId)) return hidden();
    const predicate = keyPredicate(input.bookKey);
    const row = this.database
      .prepare(
        `SELECT books.id, books.alias, books.visibility, books.title_cache,
                books.current_version_id, book_versions.state,
                book_versions.version_rel_path, book_versions.renderer_version,
                original_files.id AS file_id, original_files.original_name,
                original_files.media_type, original_files.size_bytes,
                original_files.sha256
         FROM books
         LEFT JOIN book_versions
           ON book_versions.id = books.current_version_id
          AND book_versions.book_id = books.id
          AND book_versions.reclaimed_at IS NULL
         LEFT JOIN original_files
           ON original_files.id = ?
          AND original_files.book_id = books.id
          AND original_files.source_id = book_versions.source_id
         WHERE ${predicate.sql}
         LIMIT 1`,
      )
      .get(input.fileId, predicate.value) as OriginalRow | undefined;
    if (!row) return hidden();
    const book = mapCurrent(row, input.administrator);
    if (
      !row.file_id ||
      !row.media_type ||
      !row.original_name ||
      !row.sha256 ||
      row.size_bytes === null
    ) {
      return hidden();
    }
    return Object.freeze({
      ...book,
      fileId: row.file_id,
      mediaType: row.media_type,
      originalName: row.original_name,
      originalRelativePath: `${book.versionRelativePath}/originals/${row.file_id}`,
      sha256: row.sha256,
      sizeBytes: row.size_bytes,
    });
  }
}
