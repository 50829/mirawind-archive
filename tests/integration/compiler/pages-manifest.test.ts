import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildDocumentManifest,
  canonicalJson,
} from "@/modules/publishing/core/publication/manifest";
import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import {
  documentForPage,
  pageBlockIds,
  pageMetadata,
  pageOutputPath,
} from "@/modules/publishing/core/publication/compiled-book";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import { renderSemanticDocument } from "@/modules/publishing/core/publication/render-document";

const versionId = "ver_pages_manifest_test_0001";

function fixture() {
  const source = [
    "# Preface",
    "",
    "Opening.",
    "",
    "# Chapter",
    "",
    "Body.",
    "",
    "## Details",
    "",
    "More.",
    "",
    "# Appendix",
    "",
    "Reference.",
  ].join("\n");
  let sequence = 0;
  const document = normalizeDocumentBlocks(parseMarkdownDocument(source), {
    idFactory: () =>
      `blk_pages_manifest_${String(++sequence).padStart(8, "0")}`,
  });
  const structures = document.headings.map((heading, index) => ({
    block_id: heading.blockId,
    display_level: index === 2 ? 2 : 1,
    ...(index === 0
      ? { display_title: "Introduction", role: "frontmatter" }
      : index === 1
        ? { role: "body" }
        : index === 3
          ? { role: "appendix" }
          : {}),
    include_in_toc: index !== 2,
    starts_page: index !== 2,
  }));
  const sourceHash = createHash("sha256").update(source).digest("hex");
  const config = {
    book_id: 1,
    publishing: {
      code: { line_numbers: false },
      numbering: { mode: "normalized" },
    },
    revision: 2,
    schema_version: 3,
    source: {
      main_markdown: "book.md",
      main_markdown_sha256: sourceHash,
      original_files: [],
      preprocessing: {
        typography: {
          input_sha256: sourceHash,
          output_sha256: sourceHash,
          profile: "verbatim-v1",
          protected_nodes: 0,
          punctuation_converted: 0,
          spaces_normalized: 0,
        },
      },
    },
    source_regions: [],
    structure: structures,
    title: "Test Book",
  };
  const book = compileBook({
    config,
    configSha256: createHash("sha256")
      .update(JSON.stringify(config))
      .digest("hex"),
    markdownBytes: source,
  });
  return { book, source };
}

describe("deterministic publication pages and manifest", () => {
  it("splits only at configured headings and applies role-aware numbering", () => {
    const { book } = fixture();

    expect(book.pages).toHaveLength(3);
    expect(book.pages.map((page) => pageMetadata(book, page).title)).toEqual([
      "Introduction",
      "Chapter",
      "Appendix",
    ]);
    expect(book.pages.map(pageOutputPath)).toEqual([
      "published/pages/1.html",
      "published/pages/2.html",
      "published/pages/3.html",
    ]);
    expect(book.headings.map((heading) => heading.number)).toEqual([
      null,
      "1",
      "1.1",
      "A",
    ]);
    expect(
      new Set(book.pages.flatMap((page) => pageBlockIds(book, page))).size,
    ).toBe(book.pages.flatMap((page) => pageBlockIds(book, page)).length);
  });

  it("renders each page and creates a strict closed canonical manifest", async () => {
    const { book, source } = fixture();
    const rendered = await Promise.all(
      book.pages.map((page) =>
        renderSemanticDocument({
          document: documentForPage(book, page),
          headingOverrides: book.headingOverrides,
          publishedResourceUrl: () => {
            throw new Error("No resource expected");
          },
          resourceResolution: {
            diagnostics: [],
            references: [],
            resources: [],
          },
        }),
      ),
    );
    expect(rendered[1]?.html).toContain('<span class="heading-number">1 ');
    expect(rendered[1]?.html).toContain("Details");

    const manifest = buildDocumentManifest({
      book,
      bookId: 1,
      configRevision: 2,
      createdAt: "2026-07-24T00:00:00.000Z",
      mainMarkdownOutputPath: "source/book.md",
      resourceReferences: [],
      resources: [],
      sourceFiles: [
        {
          path: "source/book.md",
          sha256: createHash("sha256").update(source).digest("hex"),
          size: Buffer.byteLength(source),
        },
      ],
      versionId,
    });
    expect(manifest).toMatchObject({
      book_id: 1,
      config_revision: 2,
      version_id: versionId,
    });
    expect(manifest.toc).toHaveLength(3);
    expect(canonicalJson(manifest)).toBe(canonicalJson(manifest));
    expect(canonicalJson(manifest).endsWith("\n")).toBe(true);
  });

  it("assigns deduplicated resource IDs by exact source position", () => {
    const source = "# Chapter\n\n![Diagram](diagram.png)\n";
    const sourceHash = createHash("sha256").update(source).digest("hex");
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
        main_markdown_sha256: sourceHash,
        original_files: [],
        preprocessing: {
          typography: {
            input_sha256: sourceHash,
            output_sha256: sourceHash,
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
          block_id: "blk_image_manifest_00000001",
          display_level: 1,
          include_in_toc: true,
          role: "body",
          starts_page: true,
        },
      ],
      title: "Image Book",
    };
    const book = compileBook({
      config,
      configSha256: "d".repeat(64),
      markdownBytes: source,
    });
    const image = book.document.blocks.find((block) => block.type === "image");
    const heading = book.document.headings[0];
    if (!image?.blockId || !image.position || !heading?.position) {
      throw new Error("expected positioned image and heading");
    }
    const firstResourceId = "res_image_manifest_a0001";
    const secondResourceId = "res_image_manifest_b0002";
    const resources = [
      {
        absolutePath: "/private/diagram-a.png",
        height: 1,
        id: firstResourceId,
        mediaType: "image/png",
        originalUrl: "diagram.png",
        outputPath: "published/resources/diagram-a.png",
        relativePath: "diagram-a.png",
        sha256: "a".repeat(64),
        size: 1,
        width: 1,
      },
      {
        absolutePath: "/private/diagram-b.png",
        height: 1,
        id: secondResourceId,
        mediaType: "image/png",
        originalUrl: "diagram.png",
        outputPath: "published/resources/diagram-b.png",
        relativePath: "diagram-b.png",
        sha256: "b".repeat(64),
        size: 1,
        width: 1,
      },
    ];

    const manifest = buildDocumentManifest({
      book,
      bookId: 1,
      configRevision: 1,
      createdAt: "2026-07-24T00:00:00.000Z",
      mainMarkdownOutputPath: "source/book.md",
      resourceReferences: [
        {
          originalUrl: "diagram.png",
          position: image.position,
          resourceId: secondResourceId,
        },
        {
          originalUrl: "diagram.png",
          position: image.position,
          resourceId: firstResourceId,
        },
        {
          originalUrl: "diagram.png",
          position: image.position,
          resourceId: firstResourceId,
        },
        {
          originalUrl: "diagram.png",
          position: heading.position,
          resourceId: secondResourceId,
        },
      ],
      resources,
      sourceFiles: [
        {
          path: "source/book.md",
          sha256: sourceHash,
          size: Buffer.byteLength(source),
        },
      ],
      versionId: "ver_image_manifest_0001",
    });
    const blocks = manifest.blocks as Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    >;

    expect(blocks[image.blockId]?.resource_ids).toEqual([
      firstResourceId,
      secondResourceId,
    ]);
    expect(blocks[heading.blockId]?.resource_ids).toEqual([]);
  });
});
