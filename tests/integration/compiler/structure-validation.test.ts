import { describe, expect, it } from "vitest";

import {
  type ConfigSemanticDiagnostic,
  ConfigSemanticValidationError,
  validateDocumentConfig,
} from "@/modules/publishing/core/publication/validate-config";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";

const document = normalizeDocumentBlocks(
  parseMarkdownDocument(
    [
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
    ].join("\n"),
  ),
  {
    idFactory: (() => {
      let index = 0;
      return () => `blk_0123456789abcdef${++index}`;
    })(),
  },
);

interface TestStructureNode {
  alias?: string;
  block_id: string;
  display_level: number;
  display_title?: string;
  include_in_toc: boolean;
  role?: string;
  starts_page: boolean;
}

function structure(): TestStructureNode[] {
  const levels = [1, 2, 3, 1, 2] as const;
  return document.headings.map((heading, index) => ({
    block_id: heading.blockId,
    display_level: levels[index] ?? 1,
    include_in_toc: true,
    ...(index === 0
      ? { role: "body" }
      : index === 3
        ? { role: "appendix" }
        : {}),
    starts_page: index === 0 || index === 3,
  }));
}

function config(nodes: readonly TestStructureNode[] = structure()) {
  return {
    book_id: 1,
    publishing: {
      code: { line_numbers: false },
      numbering: { mode: "normalized" },
    },
    revision: 2,
    schema_version: 3,
    source: {
      main_markdown: "main.md",
      main_markdown_sha256: "a".repeat(64),
      original_files: [],
      preprocessing: {
        typography: {
          input_sha256: "a".repeat(64),
          output_sha256: "a".repeat(64),
          profile: "verbatim-v1",
          protected_nodes: 0,
          punctuation_converted: 0,
          spaces_normalized: 0,
        },
      },
    },
    source_regions: [],
    structure: nodes,
    title: "Configured book",
  };
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
  it("applies TOC-only exclusion and display titles without removing or reordering body headings", () => {
    const nodes = structure();
    nodes[1] = {
      ...nodeAt(nodes, 1),
      display_title: "Renamed chapter",
      include_in_toc: false,
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
      display_title: "Renamed chapter",
      include_in_toc: false,
      source_title: "Chapter one",
    });
    expect(result.headings).toHaveLength(document.headings.length);
    expect(document.root).toBe(originalRoot);
  });

  it("inherits one of four roles from top-level headings", () => {
    const result = validateDocumentConfig({
      config: config(),
      document,
    });
    expect(result.headings.map((heading) => heading.role)).toEqual([
      "body",
      "body",
      "body",
      "appendix",
      "appendix",
    ]);
  });

  it("rejects skipped display levels and roles assigned below level one", () => {
    const skipped = structure();
    skipped[1] = { ...nodeAt(skipped, 1), display_level: 3 };
    hasDiagnostic(
      semanticDiagnostics(() =>
        validateDocumentConfig({ config: config(skipped), document }),
      ),
      "DISPLAY_LEVEL_SKIPPED",
      document.headings[1]?.blockId,
    );

    const nestedRole = structure();
    nestedRole[2] = { ...nodeAt(nestedRole, 2), role: "backmatter" };
    hasDiagnostic(
      semanticDiagnostics(() =>
        validateDocumentConfig({ config: config(nestedRole), document }),
      ),
      "ROLE_REQUIRES_TOP_LEVEL",
      document.headings[2]?.blockId,
    );
  });

  it("rejects heading reorder, non-heading page starts and missing heading entries", () => {
    const reordered = structure();
    [reordered[1], reordered[2]] = [nodeAt(reordered, 2), nodeAt(reordered, 1)];
    hasDiagnostic(
      semanticDiagnostics(() =>
        validateDocumentConfig({ config: config(reordered), document }),
      ),
      "HEADING_ORDER_CHANGED",
      reordered[1]?.block_id,
    );

    const paragraphId = document.blocks.find(
      (block) => block.type === "paragraph",
    )?.blockId;
    if (!paragraphId) throw new Error("Paragraph fixture block is missing");
    const nonHeading = structure();
    nonHeading[1] = {
      ...nodeAt(nonHeading, 1),
      block_id: paragraphId,
      starts_page: true,
    };
    hasDiagnostic(
      semanticDiagnostics(() =>
        validateDocumentConfig({ config: config(nonHeading), document }),
      ),
      "HEADING_REQUIRED",
      paragraphId,
    );

    hasDiagnostic(
      semanticDiagnostics(() =>
        validateDocumentConfig({
          config: config(structure().slice(0, -1)),
          document,
        }),
      ),
      "HEADING_SET_MISMATCH",
    );
  });

  it("requires page aliases to be unique and attached to page starts", () => {
    const duplicate = structure();
    duplicate[0] = { ...nodeAt(duplicate, 0), alias: "same-page" };
    duplicate[3] = { ...nodeAt(duplicate, 3), alias: "same-page" };
    hasDiagnostic(
      semanticDiagnostics(() =>
        validateDocumentConfig({ config: config(duplicate), document }),
      ),
      "PAGE_ALIAS_DUPLICATE",
      document.headings[3]?.blockId,
    );

    const notPage = structure();
    notPage[1] = { ...nodeAt(notPage, 1), alias: "chapter-one" };
    hasDiagnostic(
      semanticDiagnostics(() =>
        validateDocumentConfig({ config: config(notPage), document }),
      ),
      "PAGE_ALIAS_REQUIRES_START",
      document.headings[1]?.blockId,
    );
  });
});
