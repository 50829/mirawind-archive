import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildSearchSpool } from "@/modules/publishing/adapters/filesystem/search-spool";
import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import {
  pageBlockIds,
  pageMetadata,
  pageOutputPath,
} from "@/modules/publishing/core/publication/compiled-book";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";

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
        structure: [
          {
            block_id: document.headings[0]?.blockId,
            display_level: 1,
            include_in_toc: true,
            role: "body",
            starts_page: true,
          },
        ],
        title: "Café",
      };
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

    expect(create()).toEqual(create());
    expect(create().spool.ftsRows[0]?.title).toBe("Café");
    expect(create().spool.shortRows[1]?.normalizedText).toBe("Áuthor");
  });
});
