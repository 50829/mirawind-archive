import { createHash } from "node:crypto";

import type { BookVersionPresentation } from "@/modules/catalog/application/catalog-api";
import {
  canonicalJson,
  validateBookDocument,
  validateDocumentManifest,
} from "./publication-formats";

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
  if (Buffer.byteLength(json, "utf8") > maximumBytes)
    throw new Error(errorCode);
  return json;
}

function projectionDigest(
  input: Omit<BookVersionPresentation, "createdAtMs" | "projectionSha256">,
): string {
  return createHash("sha256")
    .update("mirawind-book-presentation-v3\0")
    .update(canonicalJson(input))
    .digest("hex");
}

export function deriveBookVersionPresentation(input: {
  readonly bookDocument: unknown;
  readonly createdAtMs: number;
  readonly documentManifest: unknown;
}): BookVersionPresentation {
  const parsedConfig = validateBookDocument(input.bookDocument);
  const manifest = validateDocumentManifest(input.documentManifest);
  if (
    !parsedConfig ||
    parsedConfig.book_id !== manifest.book_id ||
    parsedConfig.updated_at !== manifest.source_updated_at
  ) {
    throw new Error("PRESENTATION_IDENTITY_MISMATCH");
  }
  const pages = manifest.pages as readonly ManifestPage[];
  const firstPage = pages[0];
  if (!firstPage) throw new Error("PRESENTATION_FIRST_PAGE_MISSING");
  const toc = manifest.toc as readonly ManifestTocNode[];
  const metadataSource: Readonly<Record<string, unknown>> = {
    ...parsedConfig.metadata,
  };
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
  const configuredCover = parsedConfig.metadata.cover_resource_id ?? null;
  const projection = Object.freeze({
    alias: typeof parsedConfig.alias === "string" ? parsedConfig.alias : null,
    bookId: Number(parsedConfig.book_id),
    sourceUpdatedAt: Number(parsedConfig.updated_at),
    coverResourceId:
      configuredCover &&
      Object.hasOwn(manifest.resources as object, configuredCover)
        ? configuredCover
        : null,
    firstPageAlias:
      typeof firstPage.alias === "string" ? firstPage.alias : null,
    firstPageId: firstPage.page_id,
    metadataJson,
    projectionSchemaVersion: 3 as const,
    title: String(metadataSource.title),
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
