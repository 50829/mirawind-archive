import { required } from "../../helpers/required";
import { describe, expect, it } from "vitest";
import { buildSearchSpool } from "@/modules/publishing/core/publication/search-model";
import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import {
  pageBlockIds,
  pageMetadata,
  pageOutputPath,
} from "@/modules/publishing/core/publication/compiled-book";
import { smallBook, headingBlock, paragraphBlock } from "../../helpers/ir-book";
describe("same-version derived-data reproducibility", () => {
  it("produces identical page and search rows from unchanged normalized content", () => {
    const document = smallBook();
    document.blocks = [headingBlock("Cafe\u0301"), paragraphBlock("中文正文")];
    document.publishing.boundaries = {
      body_start_block_id: required(document.blocks[0]).id,
    };
    document.publishing.numbering = "generated";
    const create = () => {
      const book = compileBook(structuredClone(document));
      return {
        pages: book.pages.map((page) => ({
          blockIds: pageBlockIds(book, page),
          outputPath: pageOutputPath(page),
          pageId: page.pageId,
          title: pageMetadata(book, page).title,
        })),
        spool: buildSearchSpool({
          authors: ["A\u0301uthor"],
          book,
          bookId: 1,
          title: "Cafe\u0301",
          versionId: "ver_reproducibility_test_0001",
        }),
      };
    };
    const first = create();
    const second = create();
    expect(first).toEqual(second);
    expect(first.spool.ftsRows[0]?.title).toBe("Café");
    expect(first.spool.shortRows[1]?.normalizedText).toBe("Áuthor");
  });
});
