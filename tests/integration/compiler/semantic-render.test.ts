import { describe, expect, it } from "vitest";

import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import { renderSemanticDocument } from "@/modules/publishing/core/publication/render-document";
import type { ResourceResolution } from "@/modules/publishing/core/publication/resource-model";

function normalized(source: string) {
  let sequence = 0;
  return normalizeDocumentBlocks(parseMarkdownDocument(source), {
    idFactory: () => `blk_semantic_test_${String(++sequence).padStart(4, "0")}`,
  });
}

describe("published semantic document rendering", () => {
  it("renders ordinary document structure, figures and footnotes accessibly", async () => {
    const source = [
      "# Source heading",
      "",
      "A paragraph with *emphasis* and a [footnote][^one].",
      "",
      "- first",
      "- second",
      "",
      "| Name | Value |",
      "| --- | ---: |",
      "| alpha | 1 |",
      "",
      '![Figure caption](images/figure.png "Figure caption")',
      "",
      "[^one]: Footnote body.",
    ].join("\n");
    const document = normalized(source);
    const image = document.blocks.find((block) => block.type === "image");
    const figureParagraph = document.blocks.find(
      (block) =>
        block.type === "paragraph" &&
        block.children?.some((child) => child.type === "image"),
    );
    const resolution: ResourceResolution = {
      diagnostics: [],
      references: [
        {
          originalUrl: "images/figure.png",
          resourceId: "res_semantic_figure",
        },
      ],
      resources: [
        {
          absolutePath: "/not-read-by-renderer/figure.png",
          id: "res_semantic_figure",
          originalUrl: "images/figure.png",
          relativePath: "images/figure.png",
        },
      ],
    };
    const rendered = await renderSemanticDocument({
      document,
      headingOverrides: new Map([
        [
          document.headings[0]?.blockId ?? "",
          { displayLevel: 1, displayTitle: "Published heading" },
        ],
      ]),
      publishedResourceUrl: (resourceId) =>
        `/books/1/versions/ver_test/resources/${resourceId}`,
      resourceResolution: resolution,
    });

    expect(rendered.html).toMatch(
      new RegExp(
        `<h1 (?=[^>]*id="${document.headings[0]?.blockId}")(?=[^>]*data-block-id="${document.headings[0]?.blockId}")[^>]*>Published heading</h1>`,
        "u",
      ),
    );
    expect(rendered.html).toMatch(/<ul>[\s\S]*<li/u);
    expect(rendered.html).toMatch(
      /<table[^>]*>[\s\S]*<thead>[\s\S]*<th>[\s\S]*<tbody>/u,
    );
    expect(rendered.html).toContain(
      `<figure data-block-id="${figureParagraph?.blockId}">`,
    );
    expect(rendered.html).toContain(
      `<img src="/books/1/versions/ver_test/resources/res_semantic_figure" alt="Figure caption" data-block-id="${image?.blockId}"`,
    );
    expect(rendered.html).toContain("<figcaption>Figure caption</figcaption>");
    expect(rendered.html).toMatch(
      /role="doc-noteref"[\s\S]*role="doc-endnote"/u,
    );
    expect(rendered.diagnostics).toEqual([]);
  });

  it("pre-renders bounded math and keeps invalid source notation as text", async () => {
    const document = normalized(
      [
        '<code class="math-inline">y</code>',
        "",
        "Inline $x^2$.",
        "Untrusted $\\href{javascript:alert(1)}{x}$.",
        "",
        "$$",
        "\\frac{1}{2}",
        "$$",
        "",
        "$$",
        "\\notacommand{",
        "$$",
      ].join("\n"),
    );
    const rendered = await renderSemanticDocument({
      document,
      publishedResourceUrl: () => {
        throw new Error("No resource expected");
      },
      resourceResolution: { diagnostics: [], references: [], resources: [] },
    });

    expect(rendered.html.match(/class="katex"/gu)?.length).toBeGreaterThan(2);
    const displayMath = document.blocks.find((block) => block.type === "math");
    expect(rendered.html).toContain(`data-block-id="${displayMath?.blockId}"`);
    expect(rendered.html).toContain("math-fallback");
    expect(rendered.html).toContain("\\notacommand{");
    expect(rendered.html).not.toContain('href="javascript:');
    expect(rendered.html).not.toContain("data-mirawind-math");
    expect(rendered.diagnostics).toEqual([
      expect.objectContaining({ code: "MATH_RENDER_FAILED" }),
    ]);
  });

  it("highlights only approved code languages without inline styles", async () => {
    const document = normalized(
      [
        "```ts",
        "const answer: number = 42",
        "```",
        "",
        "```unknown-language",
        "<script>plain & safe</script>",
        "```",
      ].join("\n"),
    );
    const rendered = await renderSemanticDocument({
      document,
      publishedResourceUrl: () => {
        throw new Error("No resource expected");
      },
      resourceResolution: { diagnostics: [], references: [], resources: [] },
    });

    expect(rendered.html).toContain('data-code-language="typescript"');
    const codeBlocks = document.blocks.filter((block) => block.type === "code");
    expect(rendered.html).toContain(
      `data-block-id="${codeBlocks[0]?.blockId}"`,
    );
    expect(rendered.html).toContain(
      `data-block-id="${codeBlocks[1]?.blockId}"`,
    );
    expect(rendered.html).toContain('class="shiki');
    expect(rendered.html).not.toContain(" style=");
    expect(rendered.css).toMatch(/\.mw-shiki-[A-Za-z0-9_-]+\{/u);
    expect(rendered.html).toContain('data-code-language="plain"');
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toMatch(/plain (?:&#x26;|&amp;) safe/u);
    expect(rendered.diagnostics).toEqual([
      expect.objectContaining({ code: "CODE_LANGUAGE_UNSUPPORTED" }),
    ]);
  });

  it("emits all eight教材 containers as labelled semantic regions", async () => {
    const kinds = [
      "definition",
      "theorem",
      "proof",
      "example",
      "exercise",
      "solution",
      "note",
      "warning",
    ] as const;
    const document = normalized(
      kinds.map((kind) => `::: ${kind}\n${kind} body.\n:::`).join("\n\n"),
    );
    const rendered = await renderSemanticDocument({
      document,
      publishedResourceUrl: () => {
        throw new Error("No resource expected");
      },
      resourceResolution: { diagnostics: [], references: [], resources: [] },
    });

    for (const kind of kinds) {
      expect(rendered.html).toContain(`data-container-kind="${kind}"`);
      expect(rendered.html).toContain(`aria-label="${kind}"`);
    }
    expect(rendered.html.match(/<aside /gu)).toHaveLength(8);
  });

  it("repairs source heading fragments to stable publication targets", async () => {
    const document = normalized(
      "# First\n\n[Continue](#second-heading)\n\n# Second heading",
    );
    const second = document.headings[1];
    if (!second) throw new Error("Second heading fixture is missing");
    const rendered = await renderSemanticDocument({
      document,
      headingHref: (blockId) => `/books/1/pages/2#${blockId}`,
      publishedResourceUrl: () => {
        throw new Error("No resource expected");
      },
      resourceResolution: { diagnostics: [], references: [], resources: [] },
    });

    expect(rendered.html).toContain(
      `href="/books/1/pages/2#${second.blockId}"`,
    );
  });

  it("keeps safe external hyperlinks while removing executable URLs", async () => {
    const document = normalized(
      [
        "# References",
        "",
        "[Safe reference](https://example.test/paper)",
        "",
        "[Unsafe reference](javascript:alert(1))",
      ].join("\n"),
    );
    const rendered = await renderSemanticDocument({
      document,
      publishedResourceUrl: () => {
        throw new Error("No resource expected");
      },
      resourceResolution: { diagnostics: [], references: [], resources: [] },
    });

    expect(rendered.html).toContain(
      'href="https://example.test/paper">Safe reference</a>',
    );
    expect(rendered.html).toContain("Unsafe reference");
    expect(rendered.html).not.toContain("javascript:");
  });
});
