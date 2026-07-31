import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildSearchSpool } from "@/modules/publishing/core/publication/search-model";
import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import {
  pageBlockIds,
  pageMetadata,
  pageOutputPath,
} from "@/modules/publishing/core/publication/compiled-book";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import { createBookConfigV4 } from "../../helpers/book-config";

describe("same-version derived-data reproducibility", () => {
  it("produces identical page and search rows from unchanged normalized content", () => {
    const source = "# Cafe\u0301\n\n中文正文";
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const create = () => {
      let ordinal = 0;
      const document = normalizeDocumentBlocks(parseMarkdownDocument(source), {
        idFactory: () =>
          `blk_reproducibility_${String(++ordinal).padStart(8, "0")}`,
      });
      const config = createBookConfigV4({
        document,
        numbering: "generated",
        sourceSha256,
        title: "Café",
      });
      const book = compileBook({
        config,
        configSha256: createHash("sha256")
          .update(JSON.stringify(config))
          .digest("hex"),
        markdownBytes: source,
      });
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
