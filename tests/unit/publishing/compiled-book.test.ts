import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import {
  documentForPage,
  pageBlockIds,
} from "@/modules/publishing/core/publication/compiled-book";
import {
  createBookConfigV4,
  structureForDocument,
} from "../../helpers/book-config";

function fixture() {
  const markdown = [
    "# Preface",
    "",
    "Opening.",
    "",
    "# Chapter",
    "",
    "Body.",
    "",
    "## Details",
    "",
    "More.",
    "",
    "# Appendix",
    "",
    "Reference.",
  ].join("\n");
  const sourceSha256 = createHash("sha256").update(markdown).digest("hex");
  let blockOrdinal = 0;
  const document = normalizeDocumentBlocks(parseMarkdownDocument(markdown), {
    idFactory: () =>
      `blk_compiled_book_${String(++blockOrdinal).padStart(8, "0")}`,
  });
  const structure = structureForDocument(document).map((node, index) => ({
    ...node,
    display_level: index === 2 ? 2 : 1,
    starts_page: index !== 2,
  }));
  const config = createBookConfigV4({
    boundaries: {
      appendix_start_block_id: structure[3]?.block_id ?? "",
      body_start_block_id: structure[1]?.block_id ?? "",
    },
    document,
    numbering: "generated",
    sourceSha256,
    structure,
    title: "Compiled Book",
  });
  return compileBook({
    config,
    configSha256: "a".repeat(64),
    markdownBytes: markdown,
  });
}

describe("CompiledBook page plans", () => {
  it("covers every block exactly once with page-plan ranges", () => {
    const book = fixture();
    const plannedBlockIds = book.pages.flatMap((page) =>
      pageBlockIds(book, page),
    );

    expect(book.pages).toHaveLength(3);
    expect(plannedBlockIds).toEqual(
      book.document.blocks.flatMap((block) =>
        block.blockId ? [block.blockId] : [],
      ),
    );
    expect(new Set(plannedBlockIds).size).toBe(plannedBlockIds.length);
  });

  it("builds O(1) block, heading and page lookups once", () => {
    const book = fixture();

    for (const page of book.pages) {
      expect(book.pageById.get(page.pageId)).toBe(page);
      for (const blockId of pageBlockIds(book, page)) {
        expect(book.pageByBlockId.get(blockId)).toBe(page);
      }
    }
    for (const heading of book.headings) {
      expect(book.headingByBlockId.get(heading.block_id)).toBe(heading);
      expect(book.pageByHeadingId.get(heading.block_id)).toBe(
        book.pageByBlockId.get(heading.block_id),
      );
    }
  });

  it("creates a page view without copying AST nodes", () => {
    const book = fixture();
    const page = book.pages[1];
    if (!page) throw new Error("COMPILED_BOOK_PAGE_MISSING");
    const view = documentForPage(book, page);
    const roots = book.document.root.children ?? [];

    expect(view.root.children?.[0]).toBe(roots[page.rootRange.start]);
    expect(view.blocks[0]).toBe(book.document.blocks[page.blockRange.start]);
    expect(view.headings).toBe(book.document.headings);
    expect(view.source).toBe(book.document.source);
  });
});
