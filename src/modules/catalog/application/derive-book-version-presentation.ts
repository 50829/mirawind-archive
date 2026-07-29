import { createHash } from "node:crypto";

import type { BookVersionPresentation } from "@/modules/catalog/application/book-version-presentation";
import {
  canonicalJson,
  parseBookConfigYaml,
  validateBookConfig,
  validateDocumentManifest,
} from "@/modules/publishing/application/public";

const maximumMetadataBytes = 65_536;
const maximumTocPreviewBytes = 262_144;
const maximumTocPreviewEntries = 200;

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
