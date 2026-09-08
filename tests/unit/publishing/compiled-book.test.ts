import { required } from "../../helpers/required";
import { describe, expect, it } from "vitest";
import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import {
  documentForPage,
  pageBlockIds,
} from "@/modules/publishing/core/publication/compiled-book";
import { smallBook, headingBlock, paragraphBlock } from "../../helpers/ir-book";
function fixture() {
  const document = smallBook();
  const headings = [
    headingBlock("Preface"),
    headingBlock("Chapter"),
    headingBlock("Details", 2),
    headingBlock("Appendix"),
  ];
  document.blocks = headings.flatMap((heading) => [
    heading,
    paragraphBlock("Body."),
  ]);
  document.publishing.numbering = "generated";
  document.publishing.boundaries = {
    body_start_block_id: required(headings[1]).id,
    appendix_start_block_id: required(headings[3]).id,
  };
  return compileBook(document);
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
  });
});
