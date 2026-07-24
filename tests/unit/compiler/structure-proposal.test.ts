import { describe, expect, it } from "vitest";

import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import { proposeDocumentStructure } from "@/compiler/document/structure-proposal";

describe("default document structure proposal", () => {
  it("keeps heading order, closes level gaps and starts pages only at top-level headings", () => {
    const normalized = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## 前言",
          "Text",
          "#### Details",
          "### More",
          "# Chapter",
          "#### Deep",
          "# 附录 A",
          "## Data",
          "# 参考文献",
        ].join("\n\n"),
      ),
      {
        idFactory: (() => {
          let id = 0;
          return () => `blk_test_${++id}`;
        })(),
      },
    );
    const proposal = proposeDocumentStructure(normalized);

    expect(proposal.nodes.map((node) => node.block_id)).toEqual(
      normalized.headings.map((heading) => heading.blockId),
    );
    expect(proposal.nodes.map((node) => node.display_level)).toEqual([
      1, 2, 2, 1, 2, 1, 2, 1,
    ]);
    expect(proposal.nodes.map((node) => node.starts_page)).toEqual([
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(proposal.nodes.map((node) => node.role)).toEqual([
      "frontmatter",
      undefined,
      undefined,
      "body",
      undefined,
      "appendix",
      undefined,
      "backmatter",
    ]);
    expect(proposal.nodes.every((node) => node.include_in_toc)).toBe(true);
  });

  it("does not mutate source or normalized headings", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument("# One\n\n### Three"),
    );
    const before = JSON.stringify(document);

    proposeDocumentStructure(document);

    expect(JSON.stringify(document)).toBe(before);
  });
});
