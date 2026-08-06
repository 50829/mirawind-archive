import { createHash } from "node:crypto";

import {
  createHeadingLinkIndex,
  type CompiledBook,
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
  presentConfiguredHeadings,
  type HeadingNumberingMode,
  type HeadingPresentation,
} from "@/modules/publishing/core/publication/heading-presentation";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import type { NormalizedDocument } from "@/modules/publishing/core/preparation/document-model";
import {
  validateDocumentConfig,
  type ValidatedDocumentConfig,
} from "@/modules/publishing/core/publication/validate-config";

interface ConfigSourceBlock {
  readonly block_id: string;
  readonly end_offset: number;
  readonly kind: string;
  readonly start_offset: number;
  readonly text_fingerprint: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function createPagePlans(input: {
  readonly bookTitle: string;
  readonly document: NormalizedDocument;
  readonly headings: readonly HeadingPresentation[];
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
        title: configuredHeading?.label ?? input.bookTitle,
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
      title: heading.title,
      title_markdown: heading.title_markdown,
      include_in_toc: heading.include_in_toc,
      number: heading.number,
      source_number: heading.sourceNumber,
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

  const sourceBlocks = source.blocks as readonly ConfigSourceBlock[];
  const configuredBlockByIdentity = new Map(
    sourceBlocks.map((block) => [
      [
        block.kind,
        block.start_offset,
        block.end_offset,
        block.text_fingerprint,
      ].join("\0"),
      block.block_id,
    ]),
  );
  const assignedBlockIds = new Set<string>();
  const document = normalizeDocumentBlocks(parseMarkdownDocument(markdown), {
    idFactory(node, identity) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) {
        throw new Error("CONFIGURED_DOCUMENT_BLOCK_POSITION_MISSING");
      }
      const blockId = configuredBlockByIdentity.get(
        [node.type, start, end, identity.textFingerprint].join("\0"),
      );
      if (!blockId || assignedBlockIds.has(blockId)) {
        throw new Error("CONFIGURED_DOCUMENT_BLOCK_IDENTITY_MISMATCH");
      }
      assignedBlockIds.add(blockId);
      return blockId;
    },
  });
  if (assignedBlockIds.size !== sourceBlocks.length) {
    throw new Error("CONFIGURED_DOCUMENT_BLOCK_IDENTITY_MISMATCH");
  }
  const validated: ValidatedDocumentConfig = validateDocumentConfig({
    config,
    document,
  });
  const publishing = config.publishing as Readonly<Record<string, unknown>>;
  const numbering = publishing.numbering as Readonly<Record<string, unknown>>;
  const headings = presentConfiguredHeadings({
    headings: validated.headings,
    mode: numbering.mode as HeadingNumberingMode,
  });
  const metadata = config.metadata as Readonly<Record<string, unknown>>;
  const bookTitle = String(metadata.title);
  const { metadataById, pages } = createPagePlans({
    bookTitle,
    document,
    headings,
  });

  const blockById = new Map<string, NormalizedDocument["blocks"][number]>();
  const blockIds: string[] = [];
  const blockIndexById = new Map<string, number>();
  for (const [blockIndex, block] of document.blocks.entries()) {
    if (!block.blockId) throw new Error("COMPILED_BOOK_BLOCK_ID_MISSING");
    blockById.set(block.blockId, block);
    blockIds.push(block.blockId);
    blockIndexById.set(block.blockId, blockIndex);
  }
  const headingByBlockId = new Map(
    headings.map((heading) => [heading.block_id, heading]),
  );
  const headingLinkIndex = createHeadingLinkIndex(document, headingByBlockId);
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
    document,
    headingByBlockId: headingByBlockId as ReadonlyMap<
      string,
      HeadingPresentation
    >,
    headingLinkIndex,
    headings,
    pageByBlockId: pageByBlockId as ReadonlyMap<string, PagePlan>,
    pageByHeadingId: pageByHeadingId as ReadonlyMap<string, PagePlan>,
    pageById: pageById as ReadonlyMap<number, PagePlan>,
    pageMetadataById: metadataById,
    pages,
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
