import { createHash } from "node:crypto";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { deriveBookVersionPresentation } from "@/modules/catalog/application/public";
import { authorizePasskeyMutation } from "@/modules/identity/application/public";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import { proposeDocumentStructure } from "@/modules/publishing/core/preparation/structure-proposal";
import { validateBookConfig } from "@/modules/publishing/core/publication/book-config-schema";
import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import { pageMetadata } from "@/modules/publishing/core/publication/compiled-book";
import { buildDocumentManifest } from "@/modules/publishing/core/publication/manifest";
import {
  buildReaderNavigationTree,
  readerBreadcrumbs,
  type ReaderPageModel,
} from "@/modules/reader/application/public";

const markdown = `# Part One

Introduction.

## Chapter One

Body.

### Section One

Details.

# Appendix

Reference.
`;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("behavior-preserving architecture boundaries", () => {
  it("keeps publishing, reader, catalog and identity behavior stable", () => {
    const sourceSha256 = sha256(markdown);
    let ordinal = 0;
    const document = normalizeDocumentBlocks(parseMarkdownDocument(markdown), {
      idFactory: () => `blk_${String(++ordinal).padStart(20, "0")}`,
    });
    const structure = proposeDocumentStructure(document).nodes;
    const config = validateBookConfig({
      alias: "architecture-contract",
      book_id: 7,
      publishing: {
        code: { line_numbers: false },
        numbering: { mode: "normalized" },
      },
      revision: 3,
      schema_version: 3,
      source: {
        main_markdown: "main.md",
        main_markdown_sha256: sourceSha256,
        original_files: [],
        preprocessing: {
          typography: {
            input_sha256: sourceSha256,
            output_sha256: sourceSha256,
            profile: "verbatim-v1",
            protected_nodes: 0,
            punctuation_converted: 0,
            spaces_normalized: 0,
          },
        },
      },
      source_regions: [],
      structure,
      title: "Architecture Contract",
    });
    const configSha256 = sha256(stringify(config, { lineWidth: 0 }));
    const configured = compileBook({
      config,
      configSha256,
      markdownBytes: markdown,
    });
    const manifest = buildDocumentManifest({
      book: configured,
      bookId: 7,
      configRevision: 3,
      createdAt: "2026-07-30T00:00:00.000Z",
      mainMarkdownOutputPath: "source/main.md",
      resourceReferences: [],
      resources: [],
      sourceFiles: [
        {
          path: "source/main.md",
          sha256: sourceSha256,
          size: Buffer.byteLength(markdown),
        },
      ],
      versionId: "ver_0123456789abcdefghij",
    });
    const presentation = deriveBookVersionPresentation({
      bookConfig: config,
      createdAtMs: 1_800_000_000_000,
      documentManifest: manifest,
    });
    const toc = configured.headings.map((heading) => {
      const page = configured.pageByHeadingId.get(heading.block_id);
      if (!page) throw new Error("HEADING_PAGE_MISSING");
      return {
        blockId: heading.block_id,
        href: `/read/architecture-contract/${page.pageId}#${heading.block_id}`,
        level: heading.display_level,
        pageId: page.pageId,
        title: heading.display_title,
      };
    });
    const readerModel: ReaderPageModel = {
      bodyHtml: "<h1>Part One</h1>",
      bookKey: "architecture-contract",
      bookTitle: presentation.title,
      currentHeadingId: toc[2]?.blockId ?? null,
      currentPageId: presentation.firstPageId,
      firstPageHref: `/read/architecture-contract/${presentation.firstPageId}`,
      nextHref: null,
      originalDownloads: [],
      outline: toc.map((entry) => ({
        blockId: entry.blockId,
        href: `#${entry.blockId}`,
        level: entry.level,
        title: entry.title,
      })),
      previousHref: null,
      toc,
    };

    expect({
      catalog: {
        alias: presentation.alias,
        firstPageId: presentation.firstPageId,
        projectionSchemaVersion: presentation.projectionSchemaVersion,
        title: presentation.title,
        tocEntryCount: presentation.tocEntryCount,
      },
      identity: {
        accepted: authorizePasskeyMutation({
          adminUserId: "admin",
          authenticatedAtMs: 1_800_000_000_000,
          nowMs: 1_800_000_300_000,
          passkeyCount: 2,
          path: "/passkey/update-passkey",
          userId: "admin",
        }),
        rejected: authorizePasskeyMutation({
          adminUserId: "admin",
          authenticatedAtMs: 1_800_000_000_000,
          nowMs: 1_800_000_300_001,
          passkeyCount: 2,
          path: "/passkey/update-passkey",
          userId: "admin",
        }),
      },
      publishing: {
        compiler: configured.identity.compiler_version,
        headings: configured.headings.map((heading) => ({
          level: heading.display_level,
          number: heading.number,
          title: heading.display_title,
        })),
        pages: configured.pages.map((page) => ({
          firstBlockId: page.firstBlockId,
          id: page.pageId,
          title: pageMetadata(configured, page).title,
        })),
        renderer: configured.identity.renderer_version,
      },
      reader: {
        breadcrumbs: readerBreadcrumbs(
          readerModel.toc,
          readerModel.currentHeadingId,
        ).map((entry) => entry.blockId),
        modelKeys: Object.keys(readerModel).sort(),
        tree: buildReaderNavigationTree(readerModel.toc).map((entry) => ({
          blockId: entry.blockId,
          children: entry.children.map((child) => child.blockId),
        })),
      },
    }).toMatchInlineSnapshot(`
      {
        "catalog": {
          "alias": "architecture-contract",
          "firstPageId": 1,
          "projectionSchemaVersion": 1,
          "title": "Architecture Contract",
          "tocEntryCount": 4,
        },
        "identity": {
          "accepted": {
            "allowed": true,
          },
          "rejected": {
            "allowed": false,
            "reason": "SESSION_NOT_FRESH",
          },
        },
        "publishing": {
          "compiler": "compiler-v5",
          "headings": [
            {
              "level": 1,
              "number": "1",
              "title": "Part One",
            },
            {
              "level": 2,
              "number": "1.1",
              "title": "Chapter One",
            },
            {
              "level": 3,
              "number": "1.1.1",
              "title": "Section One",
            },
            {
              "level": 1,
              "number": "A",
              "title": "Appendix",
            },
          ],
          "pages": [
            {
              "firstBlockId": "blk_00000000000000000001",
              "id": 1,
              "title": "Part One",
            },
            {
              "firstBlockId": "blk_00000000000000000007",
              "id": 2,
              "title": "Appendix",
            },
          ],
          "renderer": "semantic-html-v5-katex-0.18.1",
        },
        "reader": {
          "breadcrumbs": [
            "blk_00000000000000000001",
            "blk_00000000000000000003",
            "blk_00000000000000000005",
          ],
          "modelKeys": [
            "bodyHtml",
            "bookKey",
            "bookTitle",
            "currentHeadingId",
            "currentPageId",
            "firstPageHref",
            "nextHref",
            "originalDownloads",
            "outline",
            "previousHref",
            "toc",
          ],
          "tree": [
            {
              "blockId": "blk_00000000000000000001",
              "children": [
                "blk_00000000000000000003",
              ],
            },
            {
              "blockId": "blk_00000000000000000007",
              "children": [],
            },
          ],
        },
      }
    `);
  });
});
