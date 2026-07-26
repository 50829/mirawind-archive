import { describe, expect, it } from "vitest";

import { deriveBookVersionPresentation } from "@/services/book-presentation";

const versionId = "ver_0123456789abcdefghij";
const resourceId = "res_0123456789abcdefghij";

function blockId(index: number): string {
  return `blk_${String(index).padStart(20, "0")}`;
}

function config(coverResourceId: string | null = resourceId) {
  return {
    alias: "example-book",
    book_id: 1,
    metadata: {
      authors: ["甲", "Author"],
      description: "A bounded description.",
      language: "zh-CN",
      ...(coverResourceId ? { cover_resource_id: coverResourceId } : {}),
    },
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
    structure: [],
    title: "Example Book",
  };
}

function manifest(tocSize = 1, includeCover = true) {
  const ids = Array.from({ length: tocSize }, (_, index) => blockId(index + 1));
  const blocks = Object.fromEntries(
    ids.map((id, index) => [
      id,
      {
        kind: "heading",
        normalized_visible_text: `Chapter ${index + 1}`,
        page_id: 1,
        resource_ids: [],
        source: {
          end: { column: 2, line: index + 1 },
          path: "source/main.md",
          start: { column: 1, line: index + 1 },
        },
        text_fingerprint: {
          algorithm: "sha256",
          normalization_version: 1,
          value: String(index).padStart(64, "0"),
        },
      },
    ]),
  );
  return {
    blocks,
    book_id: 1,
    compiler: {
      name: "mirawind-book-compiler",
      renderer_version: "semantic-html-v4-katex-0.18.1",
      text_normalization_version: 1,
      version: "compiler-v4",
    },
    config_revision: 2,
    created_at: "2026-07-25T00:00:00.000Z",
    pages: [
      {
        block_ids: ids,
        first_block_id: ids[0],
        output_path: "published/pages/1.html",
        page_id: 1,
        title: "Chapter 1",
      },
    ],
    resources: includeCover
      ? {
          [resourceId]: {
            height: 100,
            media_type: "image/png",
            output_path: `published/assets/${resourceId}`,
            sha256: "b".repeat(64),
            size: 1000,
            source_path: "source/cover.png",
            width: 80,
          },
        }
      : {},
    schema_version: 2,
    source_files: [
      { path: "source/main.md", sha256: "c".repeat(64), size: 10 },
    ],
    toc: ids.map((id, index) => ({
      block_id: id,
      level: 1,
      number: String(index + 1),
      page_id: 1,
      role: "body",
      title: `Chapter ${index + 1}`,
    })),
    version_id: versionId,
  };
}

describe("book version presentation projection", () => {
  it("derives deterministic current-version metadata and navigation", () => {
    const first = deriveBookVersionPresentation({
      bookConfig: config(),
      createdAtMs: 1000,
      documentManifest: manifest(),
    });
    const second = deriveBookVersionPresentation({
      bookConfig: config(),
      createdAtMs: 2000,
      documentManifest: manifest(),
    });

    expect(first).toMatchObject({
      alias: "example-book",
      bookId: 1,
      configRevision: 2,
      coverResourceId: resourceId,
      firstPageAlias: null,
      firstPageId: 1,
      projectionSchemaVersion: 1,
      title: "Example Book",
      tocEntryCount: 1,
      versionId,
    });
    expect(JSON.parse(first.metadataJson)).toEqual({
      authors: ["甲", "Author"],
      description: "A bounded description.",
      language: "zh-CN",
    });
    expect(JSON.parse(first.tocPreviewJson)).toEqual([
      {
        block_id: blockId(1),
        level: 1,
        number: "1",
        page_id: 1,
        role: "body",
        title: "Chapter 1",
      },
    ]);
    expect(first.projectionSha256).toBe(second.projectionSha256);
    expect(first.createdAtMs).not.toBe(second.createdAtMs);
  });

  it("caps the preview and replaces a missing cover with a placeholder", () => {
    const result = deriveBookVersionPresentation({
      bookConfig: config(),
      createdAtMs: 1000,
      documentManifest: manifest(201, false),
    });

    expect(result.coverResourceId).toBeNull();
    expect(result.tocEntryCount).toBe(201);
    expect(JSON.parse(result.tocPreviewJson)).toHaveLength(200);
    expect(Buffer.byteLength(result.metadataJson, "utf8")).toBeLessThanOrEqual(
      65_536,
    );
    expect(
      Buffer.byteLength(result.tocPreviewJson, "utf8"),
    ).toBeLessThanOrEqual(262_144);
  });

  it("rejects config and manifest identities that do not match", () => {
    expect(() =>
      deriveBookVersionPresentation({
        bookConfig: { ...config(), book_id: 2 },
        createdAtMs: 1000,
        documentManifest: manifest(),
      }),
    ).toThrow(/PRESENTATION_IDENTITY_MISMATCH/u);
  });
});
