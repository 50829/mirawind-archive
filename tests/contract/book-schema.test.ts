import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseBookConfigYaml,
  validateBookConfig,
} from "@/modules/publishing/core/publication/book-config-schema";

const examplePath = fileURLToPath(
  new URL("../../docs/schemas/examples/book.v4.yaml", import.meta.url),
);

function code(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function minimalConfig(): Record<string, unknown> {
  const sourceDigest = "a".repeat(64);
  const inputDigest = "b".repeat(64);
  const typographyDigest = "c".repeat(64);
  const blockId = "blk_schema_heading_0001";
  return {
    book_id: 1,
    boundaries: { body_start_block_id: blockId },
    metadata: { title: "Book" },
    publishing: {
      code: { line_numbers: false },
      numbering: { mode: "source" },
    },
    revision: 1,
    schema_version: 4,
    source: {
      blocks: [
        {
          block_id: blockId,
          end_offset: 6,
          kind: "heading",
          start_offset: 0,
          text_fingerprint: `tfp_v1_${"A".repeat(43)}`,
        },
      ],
      main_markdown: "source/full.md",
      main_markdown_sha256: sourceDigest,
      original_files: [],
      preprocessing: {
        content_cleanup: {
          helper_blocks_removed: 0,
          input_sha256: typographyDigest,
          output_sha256: sourceDigest,
          printed_toc_regions_removed: 0,
        },
        typography: {
          input_sha256: inputDigest,
          output_sha256: typographyDigest,
          profile: "verbatim-v1",
          protected_nodes: 0,
          punctuation_converted: 0,
          spaces_normalized: 0,
        },
      },
    },
    structure: [
      {
        block_id: blockId,
        display_level: 1,
        include_in_toc: true,
        starts_page: true,
        title_markdown: "Book",
      },
    ],
  };
}

describe("strict book.yaml schema", () => {
  it("accepts the canonical version-four YAML example", async () => {
    const result = parseBookConfigYaml(await readFile(examplePath, "utf8"));
    expect(result).toMatchObject({
      book_id: 42,
      metadata: { title: "深度学习" },
      revision: 1,
      schema_version: 4,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    [
      "alias",
      `schema_version: 4
revision: 1
book_id: 1
metadata: &metadata
  title: Book
source: *metadata`,
    ],
    [
      "duplicate key",
      `schema_version: 4
revision: 1
book_id: 1
metadata:
  title: First
  title: Second`,
    ],
    [
      "custom tag",
      `schema_version: 4
revision: 1
book_id: 1
metadata:
  title: !private Book`,
    ],
    [
      "merge key",
      `schema_version: 4
revision: 1
book_id: 1
metadata:
  <<:
    title: Book`,
    ],
  ])("rejects YAML %s features", (_label, yaml) => {
    expect(() => parseBookConfigYaml(yaml)).toThrow();
  });

  it("rejects unknown fields with bounded structural diagnostics", () => {
    const config = { ...minimalConfig(), private_notes: "must never persist" };
    try {
      validateBookConfig(config);
      throw new Error("Expected schema rejection");
    } catch (error) {
      expect(code(error)).toBe("BOOK_CONFIG_INVALID");
      expect(error).toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ keyword: "additionalProperties" }),
        ]),
      });
    }
  });

  it("accepts only strict version four", () => {
    expect(validateBookConfig(minimalConfig())).toMatchObject({
      schema_version: 4,
    });
    for (const schemaVersion of [1, 2, 3]) {
      expect(() =>
        validateBookConfig({
          ...minimalConfig(),
          schema_version: schemaVersion,
        }),
      ).toThrow(
        expect.objectContaining({ code: "BOOK_SCHEMA_VERSION_INVALID" }),
      );
    }
    expect(() =>
      validateBookConfig({ ...minimalConfig(), schema_version: 5 }),
    ).toThrow(
      expect.objectContaining({ code: "BOOK_SCHEMA_VERSION_UNSUPPORTED" }),
    );
    expect(() =>
      validateBookConfig({ ...minimalConfig(), schema_version: "4" }),
    ).toThrow(expect.objectContaining({ code: "BOOK_SCHEMA_VERSION_INVALID" }));
  });

  it("rejects invalid preprocessing provenance and source block ranges", () => {
    const config = minimalConfig();
    const source = config.source as Record<string, unknown>;
    const preprocessing = source.preprocessing as {
      typography: Record<string, unknown>;
    };
    expect(() =>
      validateBookConfig({
        ...config,
        source: {
          ...source,
          preprocessing: {
            ...(source.preprocessing as Record<string, unknown>),
            typography: {
              ...preprocessing.typography,
              profile: "smart",
            },
          },
        },
      }),
    ).toThrow(expect.objectContaining({ code: "BOOK_CONFIG_INVALID" }));

    const [block] = source.blocks as readonly Record<string, unknown>[];
    expect(() =>
      validateBookConfig({
        ...config,
        source: {
          ...source,
          blocks: [{ ...block, end_offset: 0 }],
        },
      }),
    ).toThrow(expect.objectContaining({ code: "BOOK_CONFIG_INVALID" }));
  });

  it("rejects a broken preprocessing digest chain", () => {
    const config = minimalConfig();
    const source = config.source as Record<string, unknown>;
    const preprocessing = source.preprocessing as {
      content_cleanup: Record<string, unknown>;
      typography: Record<string, unknown>;
    };
    expect(() =>
      validateBookConfig({
        ...config,
        source: {
          ...source,
          preprocessing: {
            ...preprocessing,
            content_cleanup: {
              ...preprocessing.content_cleanup,
              input_sha256: "d".repeat(64),
            },
          },
        },
      }),
    ).toThrow(expect.objectContaining({ code: "BOOK_CONFIG_INVALID" }));
  });

  it("rejects invalid boundaries and multiline heading Markdown", () => {
    const config = minimalConfig();
    const structure = config.structure as readonly Record<string, unknown>[];
    expect(() =>
      validateBookConfig({
        ...config,
        boundaries: {
          body_start_block_id: "blk_unknown_heading_0001",
        },
      }),
    ).toThrow(expect.objectContaining({ code: "BOOK_CONFIG_INVALID" }));
    expect(() =>
      validateBookConfig({
        ...config,
        structure: [{ ...structure[0], title_markdown: "First\nSecond" }],
      }),
    ).toThrow(expect.objectContaining({ code: "BOOK_CONFIG_INVALID" }));
  });

  it("does not coerce, default, remove or mutate rejected input", () => {
    const input = {
      ...minimalConfig(),
      book_id: "1",
      unknown: { nested: true },
    };
    const before = structuredClone(input);
    expect(() => validateBookConfig(input)).toThrow();
    expect(input).toEqual(before);
  });
});
