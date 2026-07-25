import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";

import { canonicalJson } from "../compiler/document/manifest.js";
import { BookPresentationRepository } from "../db/repositories/book-presentations.js";
import type { BookVersionRecord } from "../db/repositories/versions.js";
import {
  parseBookConfigYaml,
  validateBookConfig,
} from "../schemas/book-config.js";
import { validateDocumentManifest } from "../schemas/document-manifest.js";
import type { StorageLayout } from "../storage/layout.js";
import { resolveContainedPath } from "../storage/layout.js";

const maximumMetadataBytes = 65_536;
const maximumTocPreviewBytes = 262_144;
const maximumTocPreviewEntries = 200;
const maximumConfigBytes = 4 * 1024 * 1024;
const maximumManifestBytes = 64 * 1024 * 1024;

export interface BookVersionPresentation {
  readonly alias: string | null;
  readonly bookId: number;
  readonly configRevision: number;
  readonly coverResourceId: string | null;
  readonly createdAtMs: number;
  readonly firstPageAlias: string | null;
  readonly firstPageId: number;
  readonly metadataJson: string;
  readonly projectionSchemaVersion: 1;
  readonly projectionSha256: string;
  readonly title: string;
  readonly tocEntryCount: number;
  readonly tocPreviewJson: string;
  readonly versionId: string;
}

interface ManifestPage {
  readonly alias?: string;
  readonly page_id: number;
}

interface ManifestTocNode {
  readonly block_id: string;
  readonly level: number;
  readonly number: string | null;
  readonly page_id: number;
  readonly role: string;
  readonly title: string;
}

const metadataKeys = [
  "subtitle",
  "authors",
  "contributors",
  "description",
  "language",
  "publisher",
  "year",
  "edition",
  "isbn_10",
  "isbn_13",
] as const;

function boundedCanonicalJson(
  value: unknown,
  maximumBytes: number,
  errorCode: string,
): string {
  const json = canonicalJson(value);
  if (Buffer.byteLength(json, "utf8") > maximumBytes) {
    throw new Error(errorCode);
  }
  return json;
}

function projectionDigest(
  input: Omit<BookVersionPresentation, "createdAtMs" | "projectionSha256">,
): string {
  return createHash("sha256")
    .update("mirawind-book-presentation-v1\0")
    .update(canonicalJson(input))
    .digest("hex");
}

export function deriveBookVersionPresentation(input: {
  readonly bookConfig: unknown;
  readonly createdAtMs: number;
  readonly documentManifest: unknown;
}): BookVersionPresentation {
  const config =
    typeof input.bookConfig === "string"
      ? parseBookConfigYaml(input.bookConfig)
      : validateBookConfig(input.bookConfig);
  const parsedConfig =
    typeof config === "object" && config !== null
      ? (config as Readonly<Record<string, unknown>>)
      : null;
  const manifest = validateDocumentManifest(input.documentManifest);
  if (
    !parsedConfig ||
    parsedConfig.book_id !== manifest.book_id ||
    parsedConfig.revision !== manifest.config_revision
  ) {
    throw new Error("PRESENTATION_IDENTITY_MISMATCH");
  }
  const pages = manifest.pages as readonly ManifestPage[];
  const firstPage = pages[0];
  if (!firstPage) throw new Error("PRESENTATION_FIRST_PAGE_MISSING");
  const toc = manifest.toc as readonly ManifestTocNode[];
  const metadataSource =
    parsedConfig.metadata &&
    typeof parsedConfig.metadata === "object" &&
    !Array.isArray(parsedConfig.metadata)
      ? (parsedConfig.metadata as Readonly<Record<string, unknown>>)
      : {};
  const metadata = Object.fromEntries(
    metadataKeys.flatMap((key) =>
      metadataSource[key] === undefined ? [] : [[key, metadataSource[key]]],
    ),
  );
  const metadataJson = boundedCanonicalJson(
    metadata,
    maximumMetadataBytes,
    "PRESENTATION_METADATA_LIMIT",
  );
  let preview = toc.slice(0, maximumTocPreviewEntries);
  let tocPreviewJson = canonicalJson(preview);
  while (
    preview.length > 0 &&
    Buffer.byteLength(tocPreviewJson, "utf8") > maximumTocPreviewBytes
  ) {
    preview = preview.slice(0, -1);
    tocPreviewJson = canonicalJson(preview);
  }
  if (Buffer.byteLength(tocPreviewJson, "utf8") > maximumTocPreviewBytes) {
    throw new Error("PRESENTATION_TOC_LIMIT");
  }
  const configuredCover =
    typeof metadataSource.cover_resource_id === "string"
      ? metadataSource.cover_resource_id
      : null;
  const resources = manifest.resources as Readonly<Record<string, unknown>>;
  const projection = Object.freeze({
    alias: typeof parsedConfig.alias === "string" ? parsedConfig.alias : null,
    bookId: Number(parsedConfig.book_id),
    configRevision: Number(parsedConfig.revision),
    coverResourceId:
      configuredCover && resources[configuredCover] ? configuredCover : null,
    firstPageAlias:
      typeof firstPage.alias === "string" ? firstPage.alias : null,
    firstPageId: firstPage.page_id,
    metadataJson,
    projectionSchemaVersion: 1 as const,
    title: String(parsedConfig.title),
    tocEntryCount: toc.length,
    tocPreviewJson,
    versionId: String(manifest.version_id),
  });
  return Object.freeze({
    ...projection,
    createdAtMs: input.createdAtMs,
    projectionSha256: projectionDigest(projection),
  });
}

async function defaultLoadPresentation(
  layout: StorageLayout,
  version: BookVersionRecord,
): Promise<BookVersionPresentation> {
  const directory = await resolveContainedPath(
    layout.root,
    version.versionRelativePath,
  );
  const [configBytes, manifestBytes] = await Promise.all([
    readFile(resolve(directory, "book.yaml")),
    readFile(resolve(directory, "document-manifest.json")),
  ]);
  if (configBytes.byteLength > maximumConfigBytes) {
    throw new Error("PRESENTATION_CONFIG_LIMIT");
  }
  if (manifestBytes.byteLength > maximumManifestBytes) {
    throw new Error("PRESENTATION_MANIFEST_LIMIT");
  }
  return deriveBookVersionPresentation({
    bookConfig: configBytes.toString("utf8"),
    createdAtMs: version.completeAtMs,
    documentManifest: JSON.parse(manifestBytes.toString("utf8")) as unknown,
  });
}

export interface PresentationReconciliation {
  readonly failedVersionIds: readonly string[];
  readonly mismatchedVersionIds: readonly string[];
  readonly repairedCurrentBookIds: readonly number[];
  readonly rebuiltVersionIds: readonly string[];
}

export async function reconcileBookVersionPresentations(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly loadPresentation?: (
    version: BookVersionRecord,
  ) => Promise<BookVersionPresentation>;
  readonly nowMs: number;
}): Promise<PresentationReconciliation> {
  const repository = new BookPresentationRepository(input.database);
  const rebuiltVersionIds: string[] = [];
  const mismatchedVersionIds: string[] = [];
  const failedVersionIds: string[] = [];
  for (const version of repository.listReconciliationCandidates()) {
    try {
      const expected = await (input.loadPresentation
        ? input.loadPresentation(version)
        : defaultLoadPresentation(input.layout, version));
      if (
        expected.versionId !== version.id ||
        expected.bookId !== version.bookId ||
        expected.configRevision !== version.configRevision
      ) {
        throw new Error("PRESENTATION_IDENTITY_MISMATCH");
      }
      const existing = repository.find(version.id);
      if (existing) {
        if (existing.projectionSha256 !== expected.projectionSha256) {
          mismatchedVersionIds.push(version.id);
        }
        continue;
      }
      repository.insert(expected);
      rebuiltVersionIds.push(version.id);
    } catch {
      failedVersionIds.push(version.id);
    }
  }
  const rejected = new Set([...failedVersionIds, ...mismatchedVersionIds]);
  const repairedCurrentBookIds: number[] = [];
  const currentRows = input.database
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
  for (const row of currentRows) {
    if (
      rejected.has(row.current_version_id) ||
      row.alias === row.presentation_alias
    ) {
      continue;
    }
    const changed = input.database
      .prepare(
        `UPDATE books SET alias = ?, updated_at = ?
         WHERE id = ? AND current_version_id = ?
           AND deletion_requested_at IS NULL`,
      )
      .run(row.presentation_alias, input.nowMs, row.id, row.current_version_id);
    if (changed.changes === 1) repairedCurrentBookIds.push(row.id);
  }
  return Object.freeze({
    failedVersionIds: Object.freeze(failedVersionIds.sort()),
    mismatchedVersionIds: Object.freeze(mismatchedVersionIds.sort()),
    repairedCurrentBookIds: Object.freeze(repairedCurrentBookIds.sort()),
    rebuiltVersionIds: Object.freeze(rebuiltVersionIds.sort()),
  });
}
