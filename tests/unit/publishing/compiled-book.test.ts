import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import {
  documentForPage,
  pageBlockIds,
} from "@/modules/publishing/core/publication/compiled-book";

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
  const headingIds = [
    "blk_compiled_book_00000001",
    "blk_compiled_book_00000002",
    "blk_compiled_book_00000003",
    "blk_compiled_book_00000004",
  ];
  const config = {
    book_id: 1,
    publishing: {
      code: { line_numbers: false },
      numbering: { mode: "normalized" },
    },
    revision: 1,
    schema_version: 3,
    source: {
      main_markdown: "book.md",
      main_markdown_sha256: sourceSha256,
      original_files: [],
      preprocessing: {
        typography: {
          input_sha256: sourceSha256,
          output_sha256: sourceSha256,
          profile: "verbatim-v1",
          protected_nodes: 0,
          punctuation_converted: 0,
          spaces_normalized: 0,
        },
      },
    },
    source_regions: [],
    structure: headingIds.map((block_id, index) => ({
      block_id,
      display_level: index === 2 ? 2 : 1,
      include_in_toc: true,
      ...(index === 0
        ? { role: "frontmatter" }
        : index === 3
          ? { role: "appendix" }
          : index === 1
            ? { role: "body" }
            : {}),
      starts_page: index !== 2,
    })),
    title: "Compiled Book",
  };
  return compileBook({
    config,
    configSha256: "a".repeat(64),
    markdownBytes: markdown,
  });
}

describe("CompiledBook page plans", () => {
  it("covers every block exactly once with range-only page plans", () => {
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
    for (const page of book.pages) {
      expect(Object.keys(page).sort()).toEqual([
        "blockRange",
        "firstBlockId",
        "pageId",
        "rootRange",
      ]);
      expect(page).not.toHaveProperty("document");
      expect(page).not.toHaveProperty("blockIds");
      expect(page).not.toHaveProperty("headingOverrides");
    }
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
