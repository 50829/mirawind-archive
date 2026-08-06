import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildDocumentManifest,
  canonicalJson,
} from "@/modules/publishing/core/publication/manifest";
import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import { buildSearchSpool } from "@/modules/publishing/core/publication/search-model";
import {
  documentForPage,
  pageBlockIds,
  pageMetadata,
  pageOutputPath,
} from "@/modules/publishing/core/publication/compiled-book";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import { renderSemanticDocument } from "@/modules/publishing/core/publication/render-document";
import {
  createBookConfigV4,
  structureForDocument,
} from "../../helpers/book-config";

const versionId = "ver_pages_manifest_test_0001";

function fixture(numbering: "generated" | "none" | "source" = "generated") {
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
    "",
    "# Afterword",
    "",
    "Closing.",
  ].join("\n");
  let sequence = 0;
  const document = normalizeDocumentBlocks(parseMarkdownDocument(source), {
    idFactory: () =>
      `blk_pages_manifest_${String(++sequence).padStart(8, "0")}`,
  });
  const structures = structureForDocument(document).map((node, index) => ({
    ...node,
    display_level: index === 2 ? 2 : 1,
    include_in_toc: index !== 2,
    source_number: ["P", "C1", "C1.1", "A", "E"][index] ?? "",
    starts_page: index !== 2,
    ...(index === 0 ? { title_markdown: "Introduction" } : {}),
  }));
  const sourceHash = createHash("sha256").update(source).digest("hex");
  const config = createBookConfigV4({
    boundaries: {
      appendix_start_block_id: structures[3]?.block_id ?? "",
      backmatter_start_block_id: structures[4]?.block_id ?? "",
      body_start_block_id: structures[1]?.block_id ?? "",
    },
    document,
    numbering,
    revision: 2,
    sourceSha256: sourceHash,
    structure: structures,
    title: "Test Book",
  });
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
    const search = buildSearchSpool({
      authors: [],
      book,
      bookId: 1,
      title: "Test Book",
      versionId,
    });

    expect(book.pages).toHaveLength(4);
    expect(book.pages.map((page) => pageMetadata(book, page).title)).toEqual([
      "Introduction",
      "1 Chapter",
      "Appendix",
      "Afterword",
    ]);
    expect(book.pages.map(pageOutputPath)).toEqual([
      "published/pages/1.html",
      "published/pages/2.html",
      "published/pages/3.html",
      "published/pages/4.html",
    ]);
    expect(book.headings.map((heading) => heading.number)).toEqual([
      null,
      "1",
      "1.1",
      null,
      null,
    ]);
    expect(
      search.shortRows
        .filter((row) => row.kind === "heading")
        .map((row) => row.normalizedText),
    ).toEqual([
      "Introduction",
      "1 Chapter",
      "1.1 Details",
      "Appendix",
      "Afterword",
    ]);
    expect(
      new Set(book.pages.flatMap((page) => pageBlockIds(book, page))).size,
    ).toBe(book.pages.flatMap((page) => pageBlockIds(book, page)).length);
  });

  it("starts a nested body at one and rebases later shallower body headings", () => {
    const source = [
      "# Preface",
      "",
      "## Body start",
      "",
      "### Detail",
      "",
      "# Later major",
    ].join("\n");
    const sourceHash = createHash("sha256").update(source).digest("hex");
    let ordinal = 0;
    const document = normalizeDocumentBlocks(parseMarkdownDocument(source), {
      idFactory: () => `blk_nested_body_${String(++ordinal).padStart(8, "0")}`,
    });
    const structure = structureForDocument(document);
    const config = createBookConfigV4({
      boundaries: {
        body_start_block_id: structure[1]?.block_id ?? "",
      },
      document,
      numbering: "generated",
      sourceSha256: sourceHash,
      structure,
      title: "Nested Body",
    });
    const book = compileBook({
      config,
      configSha256: "a".repeat(64),
      markdownBytes: source,
    });

    expect(book.headings.map((heading) => heading.number)).toEqual([
      null,
      "1",
      "1.1",
      "2",
    ]);
  });

  it("starts body numbering at one for configured levels one through four", () => {
    for (const bodyLevel of [1, 2, 3, 4]) {
      const source = Array.from({ length: bodyLevel }, (_, index) => {
        const level = index + 1;
        const title = level === bodyLevel ? "Body start" : `Front ${level}`;
        return `${"#".repeat(level)} ${title}`;
      }).join("\n\n");
      const sourceHash = createHash("sha256").update(source).digest("hex");
      let ordinal = 0;
      const document = normalizeDocumentBlocks(parseMarkdownDocument(source), {
        idFactory: () =>
          `blk_body_level_${bodyLevel}_${String(++ordinal).padStart(8, "0")}`,
      });
      const structure = structureForDocument(document);
      const body = structure.at(-1);
      if (!body) throw new Error("TEST_BODY_HEADING_MISSING");
      const config = createBookConfigV4({
        boundaries: { body_start_block_id: body.block_id },
        document,
        numbering: "generated",
        sourceSha256: sourceHash,
        structure,
        title: `Body Level ${bodyLevel}`,
      });
      const book = compileBook({
        config,
        configSha256: "b".repeat(64),
        markdownBytes: source,
      });

      expect(book.headings.map((heading) => heading.number)).toEqual([
        ...Array.from({ length: bodyLevel - 1 }, () => null),
        "1",
      ]);
    }
  });

  it("preserves source numbers in every role and suppresses all numbers in none mode", () => {
    expect(
      fixture("source").book.headings.map((heading) => heading.number),
    ).toEqual(["P", "C1", "C1.1", "A", "E"]);
    expect(
      fixture("none").book.headings.map((heading) => heading.number),
    ).toEqual([null, null, null, null, null]);
  });

  it("renders each page and creates a strict closed canonical manifest", async () => {
    const { book, source } = fixture();
    const rendered = await Promise.all(
      book.pages.map((page) =>
        renderSemanticDocument({
          document: documentForPage(book, page),
          headingLinkIndex: book.headingLinkIndex,
          headingPresentations: book.headingByBlockId,
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
    expect(rendered[2]?.html).not.toContain('class="heading-number"');
    expect(rendered[3]?.html).not.toContain('class="heading-number"');

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
    expect(manifest.toc).toHaveLength(4);
    const toc = manifest.toc as readonly Readonly<{
      number: string | null;
    }>[];
    expect(toc.map((heading) => heading.number)).toEqual([
      null,
      "1",
      null,
      null,
    ]);
    expect(canonicalJson(manifest)).toBe(canonicalJson(manifest));
    expect(canonicalJson(manifest).endsWith("\n")).toBe(true);
  });

  it("uses one rich heading presentation across rendered and derived outputs", async () => {
    const source = "# 4.4.4 **Virtual memory** $x^2$\n\nBody.\n";
    const sourceHash = createHash("sha256").update(source).digest("hex");
    const blockId = "blk_heading_presentation_0001";
    let ordinal = 0;
    const document = normalizeDocumentBlocks(parseMarkdownDocument(source), {
      idFactory: (node) =>
        node.type === "heading"
          ? blockId
          : `blk_heading_content_${String(++ordinal).padStart(4, "0")}`,
    });
    const config = createBookConfigV4({
      document,
      numbering: "generated",
      sourceSha256: sourceHash,
      title: "Systems",
    });
    const book = compileBook({
      config,
      configSha256: "e".repeat(64),
      markdownBytes: source,
    });
    const page = book.pages[0];
    if (!page) throw new Error("heading presentation page is missing");
    const rendered = await renderSemanticDocument({
      document: documentForPage(book, page),
      headingLinkIndex: book.headingLinkIndex,
      headingPresentations: book.headingByBlockId,
      publishedResourceUrl: () => {
        throw new Error("No resource expected");
      },
      resourceResolution: { diagnostics: [], references: [], resources: [] },
    });
    const manifest = buildDocumentManifest({
      book,
      bookId: 1,
      configRevision: 1,
      createdAt: "2026-07-31T00:00:00.000Z",
      mainMarkdownOutputPath: "source/book.md",
      resourceReferences: [],
      resources: [],
      sourceFiles: [
        {
          path: "source/book.md",
          sha256: sourceHash,
          size: Buffer.byteLength(source),
        },
      ],
      versionId,
    });
    const search = buildSearchSpool({
      authors: [],
      book,
      bookId: 1,
      title: "Systems",
      versionId,
    });

    expect(book.headings[0]).toMatchObject({
      label: "1 Virtual memory x^2",
      number: "1",
      sourceNumber: "4.4.4",
      title: "Virtual memory x^2",
    });
    expect(pageMetadata(book, page).title).toBe("1 Virtual memory x^2");
    expect(rendered.html).toContain('<span class="heading-number">1 ');
    expect(rendered.html).toContain("<strong>Virtual memory</strong>");
    expect(rendered.html).toContain('class="katex"');
    expect(rendered.html).not.toContain("4.4.4");
    expect(manifest.toc).toEqual([
      expect.objectContaining({
        block_id: blockId,
        number: "1",
        title: "Virtual memory x^2",
      }),
    ]);
    expect(
      search.shortRows.find((row) => row.kind === "heading")?.normalizedText,
    ).toBe("1 Virtual memory x^2");
  });

  it("assigns deduplicated resource IDs by exact source position", () => {
    const source = "# Chapter\n\n![Diagram](diagram.png)\n";
    const sourceHash = createHash("sha256").update(source).digest("hex");
    let ordinal = 0;
    const document = normalizeDocumentBlocks(parseMarkdownDocument(source), {
      idFactory: () =>
        `blk_image_manifest_${String(++ordinal).padStart(8, "0")}`,
    });
    const config = createBookConfigV4({
      document,
      numbering: "generated",
      sourceSha256: sourceHash,
      title: "Image Book",
    });
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
