import { describe, expect, it } from "vitest";

import { buildSearchSpool } from "@/compiler/search/build-spool";
import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { numberConfiguredHeadings } from "@/compiler/document/numbering";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import { splitDocumentPages } from "@/compiler/document/pages";
import { validateDocumentConfig } from "@/compiler/document/validate-config";

describe("same-version derived-data reproducibility", () => {
  it("produces identical page and search rows from unchanged normalized content", () => {
    const source = "# Cafe\u0301\n\n中文正文";
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
        schema_version: 1,
        source: {
          main_markdown: "book.md",
          main_markdown_sha256: "a".repeat(64),
          original_files: [],
        },
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
      const headings = numberConfiguredHeadings(
        validateDocumentConfig({ config, document }).headings,
        "normalized",
      );
      const pages = splitDocumentPages({
        bookTitle: "Café",
        document,
        headings,
      });
      return {
        pages: pages.map((page) => ({
          blockIds: page.blockIds,
          outputPath: page.outputPath,
          pageId: page.pageId,
          title: page.title,
        })),
        spool: buildSearchSpool({
          authors: ["A\u0301uthor"],
          bookId: 1,
          document,
          headings,
          pages,
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
