import { createHash } from "node:crypto";
import {
  createBlockLinkIndex,
  type CompiledBook,
  type PageMetadata,
  type PagePlan,
} from "./compiled-book";
import {
  validateBookDocument,
  serializeBookDocument,
} from "../content/book-document";
import { createRenderingDocument } from "../content/rendering-document";
import { contentEntries } from "../content/content-tree";
import type { BookDocument } from "../content/book-document.generated";
import { compilerIdentity, semanticCompilationDigest } from "./manifest";
import { presentDocumentHeadings } from "./heading-presentation";

export function compileBook(input: BookDocument): CompiledBook {
  const book = validateBookDocument(input);
  const document = createRenderingDocument(book);
  const headings = presentDocumentHeadings(book);
  const headingByBlockId = new Map(
    headings.map((heading) => [heading.block_id, heading]),
  );
  const entries = [...contentEntries(book.blocks)];
  const blockIds = entries.map((entry) => entry.node.id);
  const blockById = new Map(
    document.blocks.map((block) => {
      if (!block.blockId) throw new Error("CONTENT_BLOCK_ID_MISSING");
      return [block.blockId, block];
    }),
  );
  const blockIndexById = new Map(blockIds.map((id, index) => [id, index]));
  const boundaries = [0];
  for (let index = 1; index < book.blocks.length; index++) {
    const block = book.blocks[index];
    if (block?.type === "heading" && block.starts_page) boundaries.push(index);
  }
  boundaries.push(book.blocks.length);
  const pages: PagePlan[] = [];
  const pageMetadataById = new Map<number, PageMetadata>();
  const pageByBlockId = new Map<string, PagePlan>();
  let cursor = 0;
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start === undefined || end === undefined)
      throw new Error("CONTENT_PAGE_RANGE_INVALID");
    const blockStart = cursor;
    while (cursor < entries.length) {
      const entry = entries[cursor];
      if (!entry || entry.rootIndex >= end) break;
      cursor++;
    }
    const firstBlockId = blockIds[blockStart];
    if (!firstBlockId) throw new Error("DOCUMENT_PAGE_HAS_NO_BLOCKS");
    const page: PagePlan = {
      pageId: index + 1,
      firstBlockId,
      rootRange: { start, end },
      blockRange: { start: blockStart, end: cursor },
    };
    const heading = book.blocks
      .slice(start, end)
      .find((block) => block.type === "heading");
    const presented = heading ? headingByBlockId.get(heading.id) : undefined;
    pages.push(page);
    pageMetadataById.set(page.pageId, {
      title: presented?.label ?? book.metadata.title,
      ...(presented?.alias ? { alias: presented.alias } : {}),
    });
    for (let blockIndex = blockStart; blockIndex < cursor; blockIndex++) {
      const id = blockIds[blockIndex];
      if (!id) throw new Error("CONTENT_BLOCK_ID_MISSING");
      pageByBlockId.set(id, page);
    }
  }
  const blockLinkIndex = createBlockLinkIndex(document);
  const pageByHeadingId = new Map(
    headings.map((heading) => {
      const page = pageByBlockId.get(heading.block_id);
      if (!page) throw new Error("COMPILED_BOOK_HEADING_PAGE_MISSING");
      return [heading.block_id, page];
    }),
  );
  const documentSha256 = createHash("sha256")
    .update(serializeBookDocument(book))
    .digest("hex");
  return {
    book,
    document,
    headings,
    headingByBlockId,
    blockLinkIndex,
    blockIds,
    blockById,
    blockIndexById,
    bookTitle: book.metadata.title,
    pages,
    pageMetadataById,
    pageByBlockId,
    pageByHeadingId,
    pageById: new Map(pages.map((page) => [page.pageId, page])),
    identity: {
      compiler_version: compilerIdentity.version,
      renderer_version: compilerIdentity.renderer_version,
      document_sha256: documentSha256,
      source_updated_at: book.updated_at,
      semantic_digest: semanticCompilationDigest({
        document: book,
        compiler: compilerIdentity,
        headings: headings.map((heading) => ({
          id: heading.block_id,
          number: heading.number,
          title: heading.title,
          role: heading.role,
        })),
        pages: pages.map((page) => ({
          ...page,
          title: pageMetadataById.get(page.pageId)?.title,
        })),
      }),
    },
  };
}
