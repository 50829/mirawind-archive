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
});
