import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import {
  type ConfigSemanticDiagnostic,
  ConfigSemanticValidationError,
  validateDocumentConfig,
} from "@/modules/publishing/core/publication/validate-config";
import {
  createBookConfigV4,
  structureForDocument,
  type TestStructureNode,
} from "../../helpers/book-config";

const markdown = [
  "# Part one",
  "",
  "Opening body.",
  "",
  "## Chapter one",
  "",
  "### Topic",
  "",
  "# Appendix",
  "",
  "## Tables",
].join("\n");
const sourceSha256 = createHash("sha256").update(markdown).digest("hex");
const document = normalizeDocumentBlocks(parseMarkdownDocument(markdown), {
  idFactory: (() => {
    let index = 0;
    return () => `blk_0123456789abcdef${++index}`;
  })(),
});

function structure(): TestStructureNode[] {
  const levels = [1, 2, 3, 1, 2] as const;
  return structureForDocument(document).map((node, index) => ({
    ...node,
    display_level: levels[index] ?? 1,
    starts_page: index === 0 || index === 3,
  }));
}

function config(
  nodes: readonly TestStructureNode[] = structure(),
  boundaries: Readonly<{
    appendix_start_block_id?: string;
    backmatter_start_block_id?: string;
    body_start_block_id: string;
  }> = {
    appendix_start_block_id: document.headings[3]?.blockId ?? "",
    body_start_block_id: document.headings[0]?.blockId ?? "",
  },
) {
  return createBookConfigV4({
    boundaries,
    document,
    numbering: "generated",
    revision: 2,
    sourceSha256,
    structure: nodes,
    title: "Configured book",
  });
}

function nodeAt(
  nodes: readonly TestStructureNode[],
  index: number,
): TestStructureNode {
  const node = nodes[index];
  if (!node) throw new Error(`Missing structure fixture node ${index}`);
  return node;
}

function semanticDiagnostics(callback: () => unknown) {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigSemanticValidationError);
    return (error as ConfigSemanticValidationError).diagnostics;
  }
  throw new Error("Expected semantic validation to fail");
}

function hasDiagnostic(
  diagnostics: readonly ConfigSemanticDiagnostic[],
  code: ConfigSemanticDiagnostic["code"],
  blockId?: string,
) {
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      ...(blockId ? { block_id: blockId } : {}),
      code,
    }),
  );
}

describe("book structure semantic validation", () => {
  it("applies rich heading labels and TOC visibility without changing source order", () => {
    const nodes = structure();
    nodes[1] = {
      ...nodeAt(nodes, 1),
      include_in_toc: false,
      title_markdown: "Renamed *chapter*",
    };
    const originalRoot = document.root;
    const result = validateDocumentConfig({
      config: config(nodes),
      document,
    });

    expect(result.headings.map((heading) => heading.block_id)).toEqual(
      document.headings.map((heading) => heading.blockId),
    );
    expect(result.headings[1]).toMatchObject({
      include_in_toc: false,
      source_title: "Chapter one",
      title_markdown: "Renamed *chapter*",
    });
    expect(document.root).toBe(originalRoot);
  });

  it("derives frontmatter, body, appendix and backmatter from ordered boundaries", () => {
    const result = validateDocumentConfig({
      config: config(structure(), {
        appendix_start_block_id: document.headings[3]?.blockId ?? "",
        backmatter_start_block_id: document.headings[4]?.blockId ?? "",
        body_start_block_id: document.headings[1]?.blockId ?? "",
      }),
      document,
    });

    expect(result.headings.map((heading) => heading.role)).toEqual([
      "frontmatter",
      "body",
      "body",
      "appendix",
      "backmatter",
    ]);
  });

  it("rejects skipped display levels", () => {
    const skipped = structure();
    skipped[1] = { ...nodeAt(skipped, 1), display_level: 3 };
    hasDiagnostic(
      semanticDiagnostics(() =>
        validateDocumentConfig({ config: config(skipped), document }),
      ),
      "DISPLAY_LEVEL_SKIPPED",
      document.headings[1]?.blockId,
    );
  });

  it("rejects a config whose stable block identities do not match Markdown", () => {
    const changedDocument = normalizeDocumentBlocks(
      parseMarkdownDocument(markdown.replace("Opening body.", "Changed body.")),
      {
        idFactory: (() => {
          let index = 0;
          return () => `blk_0123456789abcdef${++index}`;
        })(),
      },
    );

    hasDiagnostic(
      semanticDiagnostics(() =>
        validateDocumentConfig({ config: config(), document: changedDocument }),
      ),
      "BLOCK_IDENTITY_MISMATCH",
    );
  });

  it("rejects duplicate aliases and aliases on headings that do not start pages", () => {
    const duplicate = structure();
    duplicate[0] = { ...nodeAt(duplicate, 0), alias: "same-page" };
    duplicate[3] = { ...nodeAt(duplicate, 3), alias: "same-page" };
    expect(() =>
      validateDocumentConfig({ config: config(duplicate), document }),
    ).toThrow("The book configuration violates a semantic constraint.");

    const notPage = structure();
    notPage[1] = { ...nodeAt(notPage, 1), alias: "chapter-one" };
    expect(() =>
      validateDocumentConfig({ config: config(notPage), document }),
    ).toThrow("The book configuration violates a semantic constraint.");
  });
});
