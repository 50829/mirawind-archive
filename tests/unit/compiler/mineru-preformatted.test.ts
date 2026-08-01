import { describe, expect, it } from "vitest";

import { normalizeMineruPreformattedMarkdown } from "@/modules/publishing/core/preparation/mineru-preformatted";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";

describe("MinerU preformatted blocks", () => {
  it("turns complete algorithm HTML into literal code without creating headings", () => {
    const source = [
      "# Chapter",
      "",
      '<div class="mineru-algorithm" style="white-space: pre-wrap;">',
      "Coefficients:",
      "technical\\_token &lt; 2e-16",
      "```nested```",
      "---",
      "</div>",
      "",
      "Body remains.",
    ].join("\n");

    const markdown = normalizeMineruPreformattedMarkdown(source);
    const document = normalizeDocumentBlocks(parseMarkdownDocument(markdown));

    expect(markdown).toContain("````text\nCoefficients:");
    expect(markdown).toContain("technical\\_token < 2e-16");
    expect(markdown).not.toContain("mineru-algorithm");
    expect(document.headings.map((heading) => heading.sourceTitle)).toEqual([
      "Chapter",
    ]);
    expect(document.root.children?.some((node) => node.type === "code")).toBe(
      true,
    );
  });

  it("leaves an unterminated container unchanged", () => {
    const source =
      '<div class="mineru-algorithm">\nconsole output\n# real heading';
    expect(normalizeMineruPreformattedMarkdown(source)).toBe(source);
  });

  it("restores adjacent function calls misclassified as a heading", () => {
    const source = [
      "Run the following code.",
      "",
      "## library ( car )",
      "",
      'linearHypothesis ( lm\\_msoft , c (" dprod =0") )',
      "",
      "The output follows.",
    ].join("\n");

    const markdown = normalizeMineruPreformattedMarkdown(source);
    const document = normalizeDocumentBlocks(parseMarkdownDocument(markdown));

    expect(markdown).toContain(
      '```r\nlibrary ( car )\nlinearHypothesis ( lm_msoft , c (" dprod =0") )\n```',
    );
    expect(document.headings).toHaveLength(0);
    expect(document.root.children?.some((node) => node.type === "code")).toBe(
      true,
    );
  });
});
