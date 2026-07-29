import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildDocumentManifest,
  canonicalJson,
} from "@/modules/publishing/core/publication/manifest";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { numberConfiguredHeadings } from "@/modules/publishing/core/publication/numbering";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import { splitDocumentPages } from "@/modules/publishing/core/publication/pages";
import { validateDocumentConfig } from "@/modules/publishing/core/publication/validate-config";
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
  const validated = validateDocumentConfig({ config, document });
  const headings = numberConfiguredHeadings(validated.headings, "normalized");
  const pages = splitDocumentPages({
    bookTitle: "Test Book",
    document,
    headings,
  });
  return { document, headings, pages, source };
}

describe("deterministic publication pages and manifest", () => {
  it("splits only at configured headings and applies role-aware numbering", () => {
    const { headings, pages } = fixture();

    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.title)).toEqual([
      "Introduction",
      "Chapter",
      "Appendix",
    ]);
    expect(pages.map((page) => page.outputPath)).toEqual([
      "published/pages/1.html",
      "published/pages/2.html",
      "published/pages/3.html",
    ]);
    expect(headings.map((heading) => heading.number)).toEqual([
      null,
      "1",
      "1.1",
      "A",
    ]);
    expect(new Set(pages.flatMap((page) => page.blockIds)).size).toBe(
      pages.flatMap((page) => page.blockIds).length,
    );
  });

  it("renders each page and creates a strict closed canonical manifest", async () => {
    const { document, headings, pages, source } = fixture();
    const rendered = await Promise.all(
      pages.map((page) =>
        renderSemanticDocument({
          document: page.document,
          headingOverrides: page.headingOverrides,
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
      bookId: 1,
      configRevision: 2,
      createdAt: "2026-07-24T00:00:00.000Z",
      document,
      headings,
      mainMarkdownOutputPath: "source/book.md",
      pages,
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
