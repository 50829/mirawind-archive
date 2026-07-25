import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  migrateBookConfigToCurrent,
  parseBookConfigYaml,
  validateBookConfig,
} from "@/schemas/book-config";

const examplePath = fileURLToPath(
  new URL("../../docs/schemas/examples/book.v1.yaml", import.meta.url),
);

function code(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function minimalConfig(): Record<string, unknown> {
  return {
    book_id: 1,
    publishing: {
      code: { line_numbers: false },
      numbering: { mode: "normalized" },
    },
    revision: 1,
    schema_version: 1,
    source: {
      main_markdown: "source/full.md",
      main_markdown_sha256: "a".repeat(64),
      original_files: [],
    },
    structure: [],
    title: "Book",
  };
}

function minimalVersionTwoConfig(): Record<string, unknown> {
  const digest = "a".repeat(64);
  return {
    ...minimalConfig(),
    schema_version: 2,
    source: {
      main_markdown: "source/full.md",
      main_markdown_sha256: digest,
      original_files: [],
      preprocessing: {
        typography: {
          input_sha256: digest,
          output_sha256: digest,
          profile: "preserve-v1",
          protected_nodes: 0,
          punctuation_converted: 0,
          spaces_normalized: 0,
        },
      },
    },
    source_regions: [],
  };
}

describe("strict book.yaml schema", () => {
  it("accepts the canonical version-one YAML example", async () => {
    const result = parseBookConfigYaml(await readFile(examplePath, "utf8"));
    expect(result).toMatchObject({
      book_id: 42,
      revision: 1,
      schema_version: 1,
      title: "深度学习",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    [
      "alias",
      `schema_version: 1
revision: 1
book_id: 1
title: Book
metadata: &metadata
  language: zh-CN
source: *metadata
publishing: {}
structure: []`,
    ],
    [
      "duplicate key",
      `schema_version: 1
revision: 1
book_id: 1
title: First
title: Second
source: {}
publishing: {}
structure: []`,
    ],
    [
      "custom tag",
      `schema_version: 1
revision: 1
book_id: 1
title: !private Book
source: {}
publishing: {}
structure: []`,
    ],
    [
      "merge key",
      `schema_version: 1
revision: 1
book_id: 1
title: Book
metadata:
  <<:
    language: zh-CN
source: {}
publishing: {}
structure: []`,
    ],
  ])("rejects YAML %s features", (_label, yaml) => {
    expect(() => parseBookConfigYaml(yaml)).toThrow();
  });

  it("rejects unknown fields and reports bounded structural diagnostics", () => {
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

  it("accepts strict version two and dispatches unsupported versions", () => {
    expect(validateBookConfig(minimalVersionTwoConfig())).toMatchObject({
      schema_version: 2,
      source_regions: [],
    });
    expect(() =>
      validateBookConfig({ ...minimalConfig(), schema_version: 3 }),
    ).toThrow(
      expect.objectContaining({ code: "BOOK_SCHEMA_VERSION_UNSUPPORTED" }),
    );
    expect(() =>
      validateBookConfig({ ...minimalConfig(), schema_version: "1" }),
    ).toThrow(expect.objectContaining({ code: "BOOK_SCHEMA_VERSION_INVALID" }));
  });

  it("migrates version one to deterministic preserve-v1 provenance", () => {
    const source = minimalConfig();
    const migrated = migrateBookConfigToCurrent(source);
    expect(migrated).toEqual({
      ...source,
      schema_version: 2,
      source: {
        ...(source.source as Record<string, unknown>),
        preprocessing: {
          typography: {
            input_sha256: "a".repeat(64),
            output_sha256: "a".repeat(64),
            profile: "preserve-v1",
            protected_nodes: 0,
            punctuation_converted: 0,
            spaces_normalized: 0,
          },
        },
      },
      source_regions: [],
    });
    expect(migrateBookConfigToCurrent(migrated)).toEqual(migrated);
    expect(source).toEqual(minimalConfig());
  });

  it("rejects invalid preprocessing provenance and range bounds", () => {
    const config = minimalVersionTwoConfig();
    const source = config.source as Record<string, unknown>;
    expect(() =>
      validateBookConfig({
        ...config,
        source: {
          ...source,
          preprocessing: {
            typography: {
              ...(
                source.preprocessing as {
                  typography: Record<string, unknown>;
                }
              ).typography,
              profile: "smart",
            },
          },
        },
      }),
    ).toThrow(expect.objectContaining({ code: "BOOK_CONFIG_INVALID" }));

    expect(() =>
      validateBookConfig({
        ...config,
        source_regions: [
          {
            disposition: "reference_only",
            entries: [],
            kind: "printed_toc",
            range: {
              end_byte: 10,
              sha256: "b".repeat(64),
              start_byte: 10,
            },
            region_id: "region_abcdefghijklmnop",
            source_path: "source/full.md",
            source_sha256: "a".repeat(64),
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "BOOK_CONFIG_INVALID" }));
  });

  it("rejects provenance whose output digest differs from main Markdown", () => {
    const config = minimalVersionTwoConfig();
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
            typography: {
              ...preprocessing.typography,
              output_sha256: "b".repeat(64),
            },
          },
        },
      }),
    ).toThrow(expect.objectContaining({ code: "BOOK_CONFIG_INVALID" }));
  });

  it("does not coerce, default, remove or otherwise mutate rejected input", () => {
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
