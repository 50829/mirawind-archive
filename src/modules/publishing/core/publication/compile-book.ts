import { createHash } from "node:crypto";

import {
  createHeadingLinkIndex,
  type CompiledBook,
  type HeadingOverride,
  type PageMetadata,
  type PagePlan,
} from "@/modules/publishing/core/publication/compiled-book";
import { validateBookConfig } from "@/modules/publishing/core/publication/book-config-schema";
import {
  compilerIdentity,
  semanticCompilationDigest,
} from "@/modules/publishing/core/publication/manifest";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import {
  numberConfiguredHeadings,
  type NumberedHeading,
} from "@/modules/publishing/core/publication/numbering";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import { applySourceRegions } from "@/modules/publishing/core/preparation/source-regions";
import type {
  ConfirmedSourceRegion,
  NormalizedDocument,
} from "@/modules/publishing/core/preparation/document-model";
import {
  validateDocumentConfig,
  type ValidatedDocumentConfig,
} from "@/modules/publishing/core/publication/validate-config";

interface ConfigStructureNode {
  readonly block_id: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function configuredBlockId(configSha256: string, ordinal: number): string {
  return `blk_${createHash("sha256")
    .update("mirawind-configured-block-v1\0")
    .update(configSha256)
    .update("\0")
    .update(String(ordinal))
    .digest("base64url")
    .slice(0, 24)}`;
}

function configuredStructure(
  config: Readonly<Record<string, unknown>>,
): readonly ConfigStructureNode[] {
  return config.structure as readonly ConfigStructureNode[];
}

function configuredRegions(
  config: Readonly<Record<string, unknown>>,
): readonly ConfirmedSourceRegion[] {
  return (config.source_regions as readonly ConfirmedSourceRegion[]).filter(
    (region) => region.applied,
  );
}

function createPagePlans(input: {
  readonly bookTitle: string;
  readonly document: NormalizedDocument;
  readonly headings: readonly NumberedHeading[];
}): {
  readonly metadataById: ReadonlyMap<number, PageMetadata>;
  readonly pages: readonly PagePlan[];
} {
  const roots = input.document.root.children ?? [];
  if (roots.length === 0 || input.document.blocks.length === 0) {
    throw new Error("DOCUMENT_HAS_NO_PUBLISHABLE_BLOCKS");
  }
  const headingById = new Map(
    input.headings.map((heading) => [heading.block_id, heading]),
  );
  const rootBoundaries = [0];
  for (let rootIndex = 1; rootIndex < roots.length; rootIndex += 1) {
    const root = roots[rootIndex];
    if (
      root?.type === "heading" &&
      root.blockId &&
      headingById.get(root.blockId)?.starts_page
    ) {
      rootBoundaries.push(rootIndex);
    }
  }
  rootBoundaries.push(roots.length);

  const pages: PagePlan[] = [];
  const metadataById = new Map<number, PageMetadata>();
  let blockCursor = 0;
  for (let ordinal = 0; ordinal < rootBoundaries.length - 1; ordinal += 1) {
    const rootStart = rootBoundaries[ordinal];
    const rootEnd = rootBoundaries[ordinal + 1];
    if (rootStart === undefined || rootEnd === undefined) continue;
    const startOffset =
      roots[rootStart]?.position?.start.offset ?? Number.NEGATIVE_INFINITY;
    const endOffset =
      rootEnd === roots.length
        ? Number.POSITIVE_INFINITY
        : (roots[rootEnd]?.position?.start.offset ?? Number.POSITIVE_INFINITY);
    while (
      blockCursor < input.document.blocks.length &&
      (input.document.blocks[blockCursor]?.position?.start.offset ??
        Number.POSITIVE_INFINITY) < startOffset
    ) {
      blockCursor += 1;
    }
    const blockStart = blockCursor;
    while (
      blockCursor < input.document.blocks.length &&
      (input.document.blocks[blockCursor]?.position?.start.offset ??
        Number.POSITIVE_INFINITY) < endOffset
    ) {
      blockCursor += 1;
    }
    const firstBlockId = input.document.blocks[blockStart]?.blockId;
    if (!firstBlockId || blockCursor === blockStart) {
      throw new Error("DOCUMENT_PAGE_HAS_NO_BLOCKS");
    }
    let firstHeadingBlockId: string | undefined;
    for (let rootIndex = rootStart; rootIndex < rootEnd; rootIndex += 1) {
      const root = roots[rootIndex];
      if (root?.type === "heading" && root.blockId) {
        firstHeadingBlockId = root.blockId;
        break;
      }
    }
    const configuredHeading = firstHeadingBlockId
      ? headingById.get(firstHeadingBlockId)
      : undefined;
    const pageId = ordinal + 1;
    const page = Object.freeze({
      blockRange: Object.freeze({ end: blockCursor, start: blockStart }),
      firstBlockId,
      pageId,
      rootRange: Object.freeze({ end: rootEnd, start: rootStart }),
    });
    pages.push(page);
    metadataById.set(
      pageId,
      Object.freeze({
        ...(configuredHeading?.alias ? { alias: configuredHeading.alias } : {}),
        title: configuredHeading?.display_title ?? input.bookTitle,
      }),
    );
  }
  return Object.freeze({
    metadataById: metadataById as ReadonlyMap<number, PageMetadata>,
    pages: Object.freeze(pages),
  });
}

function semanticPayload(input: {
  readonly book: Pick<
    CompiledBook,
    "blockIds" | "document" | "headings" | "pageMetadataById" | "pages"
  >;
  readonly configSha256: string;
  readonly sourceSha256: string;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    blocks: input.book.document.blocks.map((block) => ({
      block_id: block.blockId,
      kind: block.type,
      source_end: block.position?.end.offset,
      source_start: block.position?.start.offset,
      visible_text: block.visibleText ?? "",
    })),
    compiler: compilerIdentity,
    config_sha256: input.configSha256,
    headings: input.book.headings.map((heading) => ({
      alias: heading.alias ?? null,
      block_id: heading.block_id,
      display_level: heading.display_level,
      display_title: heading.display_title,
      include_in_toc: heading.include_in_toc,
      number: heading.number,
      role: heading.role,
      starts_page: heading.starts_page,
    })),
    pages: input.book.pages.map((page) => ({
      alias: input.book.pageMetadataById.get(page.pageId)?.alias ?? null,
      block_ids: input.book.blockIds.slice(
        page.blockRange.start,
        page.blockRange.end,
      ),
      first_block_id: page.firstBlockId,
      page_id: page.pageId,
      title: input.book.pageMetadataById.get(page.pageId)?.title,
    })),
    source_sha256: input.sourceSha256,
  });
}

export function compileBook(input: {
  readonly config: unknown;
  readonly configSha256: string;
  readonly markdownBytes: string | Uint8Array;
  readonly sourceHeadingBlockIds?: readonly string[];
}): CompiledBook {
  if (!/^[a-f0-9]{64}$/u.test(input.configSha256)) {
    throw new Error("CONFIGURED_DOCUMENT_CONFIG_HASH_INVALID");
  }
  const config = validateBookConfig(input.config);
  const source = config.source as Readonly<Record<string, unknown>>;
  const sourceSha256 = String(source.main_markdown_sha256);
  const markdown =
    typeof input.markdownBytes === "string"
      ? input.markdownBytes
      : Buffer.from(input.markdownBytes).toString("utf8");
  if (sha256(markdown) !== sourceSha256) {
    throw new Error("CONFIGURED_DOCUMENT_SOURCE_HASH_MISMATCH");
  }

  const structure = configuredStructure(config);
  const sourceHeadingBlockIds =
    input.sourceHeadingBlockIds ?? structure.map((heading) => heading.block_id);
  let headingIndex = 0;
  let blockOrdinal = 0;
  const fullDocument = normalizeDocumentBlocks(
    parseMarkdownDocument(markdown),
    {
      idFactory(node) {
        if (node.type === "heading") {
          const blockId = sourceHeadingBlockIds[headingIndex++];
          if (!blockId) {
            throw new Error("CONFIGURED_DOCUMENT_HEADING_COUNT_MISMATCH");
          }
          return blockId;
        }
        return configuredBlockId(input.configSha256, ++blockOrdinal);
      },
    },
  );
  if (
    headingIndex !== sourceHeadingBlockIds.length ||
    sourceHeadingBlockIds.length !== structure.length
  ) {
    throw new Error("CONFIGURED_DOCUMENT_HEADING_COUNT_MISMATCH");
  }

  const sourceRegions = configuredRegions(config);
  const applied = applySourceRegions({
    document: fullDocument,
    mainMarkdownPath: String(source.main_markdown),
    mainMarkdownSha256: sourceSha256,
    regions: sourceRegions,
  });
  const validated: ValidatedDocumentConfig = validateDocumentConfig({
    activeDocument: applied.document,
    config,
    document: fullDocument,
  });
  const publishing = config.publishing as Readonly<Record<string, unknown>>;
  const numbering = publishing.numbering as Readonly<Record<string, unknown>>;
  const headings = numberConfiguredHeadings(
    validated.headings,
    numbering.mode === "preserve" ? "preserve" : "normalized",
  );
  const bookTitle = String(config.title);
  const { metadataById, pages } = createPagePlans({
    bookTitle,
    document: applied.document,
    headings,
  });

  const blockById = new Map<string, NormalizedDocument["blocks"][number]>();
  const blockIds: string[] = [];
  const blockIndexById = new Map<string, number>();
  for (const [blockIndex, block] of applied.document.blocks.entries()) {
    if (!block.blockId) throw new Error("COMPILED_BOOK_BLOCK_ID_MISSING");
    blockById.set(block.blockId, block);
    blockIds.push(block.blockId);
    blockIndexById.set(block.blockId, blockIndex);
  }
  const headingByBlockId = new Map(
    headings.map((heading) => [heading.block_id, heading]),
  );
  const headingOverrides = new Map<string, HeadingOverride>(
    headings.map((heading) => [
      heading.block_id,
      Object.freeze({
        displayLevel: heading.display_level,
        displayTitle: heading.display_title,
        number: heading.number,
      }),
    ]),
  );
  const headingLinkIndex = createHeadingLinkIndex(
    applied.document,
    headingOverrides,
  );
  const pageById = new Map(pages.map((page) => [page.pageId, page]));
  const pageByBlockId = new Map<string, PagePlan>();
  for (const page of pages) {
    for (
      let index = page.blockRange.start;
      index < page.blockRange.end;
      index += 1
    ) {
      const blockId = blockIds[index];
      if (blockId) pageByBlockId.set(blockId, page);
    }
  }
  const pageByHeadingId = new Map<string, PagePlan>();
  for (const heading of headings) {
    const page = pageByBlockId.get(heading.block_id);
    if (!page) throw new Error("COMPILED_BOOK_HEADING_PAGE_MISSING");
    pageByHeadingId.set(heading.block_id, page);
  }

  const withoutIdentity = {
    blockById: blockById as ReadonlyMap<
      string,
      NormalizedDocument["blocks"][number]
    >,
    blockIds: Object.freeze(blockIds),
    blockIndexById: blockIndexById as ReadonlyMap<string, number>,
    bookTitle,
    document: applied.document,
    excludedBlockIds: applied.excludedBlockIds,
    fullDocument,
    headingByBlockId: headingByBlockId as ReadonlyMap<string, NumberedHeading>,
    headingLinkIndex,
    headingOverrides: headingOverrides as ReadonlyMap<string, HeadingOverride>,
    headings,
    pageByBlockId: pageByBlockId as ReadonlyMap<string, PagePlan>,
    pageByHeadingId: pageByHeadingId as ReadonlyMap<string, PagePlan>,
    pageById: pageById as ReadonlyMap<number, PagePlan>,
    pageMetadataById: metadataById,
    pages,
    sourceRegions,
    validated,
  };
  const semanticDigest = semanticCompilationDigest(
    semanticPayload({
      book: withoutIdentity,
      configSha256: input.configSha256,
      sourceSha256,
    }),
  );
  return Object.freeze({
    ...withoutIdentity,
    identity: Object.freeze({
      compiler_version: compilerIdentity.version,
      config_sha256: input.configSha256,
      renderer_version: compilerIdentity.renderer_version,
      semantic_digest: semanticDigest,
      source_sha256: sourceSha256,
    }),
  });
}
