import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { authorizePreviewHtmlResources } from "@/http/authorization/preview-resource";
import { responsePolicyFor } from "@/http/cache/policies";
import { materializeCandidatePages } from "@/modules/publishing/adapters/reader-html/candidate-materializer";
import { createCandidateFileInventory } from "@/modules/publishing/adapters/filesystem/candidate-file-inventory";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import { buildManifestPageRecord } from "@/modules/publishing/core/publication/manifest";
import { renderSemanticDocument } from "@/modules/publishing/core/publication/render-document";
import { buildSearchSpool } from "@/modules/publishing/core/publication/search-model";
import { createTemporaryDataRoot } from "../../helpers/data-root.js";
import {
  createBookConfigV4,
  structureForDocument,
} from "../../helpers/book-config";

const headingIds = [
  "blk_candidate_preview_0001",
  "blk_candidate_preview_0002",
] as const;
const resourceId = "res_candidate_preview_0001";

function compiledFixture() {
  const markdown =
    "# First\n\n[Go to second](#second)\n\n![Diagram](diagram.png)\n\n# Second\n\nBody.\n";
  const sourceSha256 = createHash("sha256").update(markdown).digest("hex");
  let headingOrdinal = 0;
  let contentOrdinal = 0;
  const document = normalizeDocumentBlocks(parseMarkdownDocument(markdown), {
    idFactory: (node) =>
      node.type === "heading"
        ? (headingIds[headingOrdinal++] ?? "blk_candidate_preview_overflow")
        : `blk_candidate_preview_content_${String(++contentOrdinal).padStart(4, "0")}`,
  });
  const structure = structureForDocument(document).map((node, index) => ({
    ...node,
    include_in_toc: index === 0,
  }));
  const config = createBookConfigV4({
    bookId: 7,
    document,
    metadata: { authors: ["Author"], language: "en" },
    numbering: "generated",
    revision: 3,
    sourceSha256,
    structure,
    title: "Candidate Preview",
  });
  return {
    book: compileBook({
      config,
      configSha256: "b".repeat(64),
      markdownBytes: markdown,
    }),
    config,
  };
}

function article(html: string): string {
  const match = /<article[^>]*>([\s\S]*?)<\/article>/u.exec(html);
  if (!match?.[1]) throw new Error("TEST_READER_ARTICLE_MISSING");
  return match[1];
}

function normalizedArticle(html: string): string {
  return article(html)
    .replaceAll(/\/api\/manage\/books\/7\/preview\/3\/pages\/2/gu, "/page/2")
    .replaceAll(/\/read\/7\/2/gu, "/page/2")
    .replaceAll(/\/api\/manage\/books\/7\/preview\/3\/assets\//gu, "/asset/")
    .replaceAll(/\/books\/7\/assets\/ver_candidate_0001\//gu, "/asset/");
}

describe("candidate preview materialization", () => {
  it("renders semantic pages once and applies isolated preview/public policies", async () => {
    const dataRoot = await createTemporaryDataRoot("candidate-preview");
    try {
      const { book, config } = compiledFixture();
      const candidateDirectory = resolve(dataRoot.path, "candidate");
      const renderPage = vi.fn(renderSemanticDocument);
      const result = await materializeCandidatePages({
        bookId: 7,
        candidateDirectory,
        compiled: book,
        config,
        configRevision: 3,
        files: createCandidateFileInventory(candidateDirectory),
        originalFiles: [{ id: "orig_candidate_0001", role: "mineru_zip" }],
        renderPage,
        resourceResolution: {
          diagnostics: [],
          references: [{ originalUrl: "diagram.png", resourceId }],
          resources: [
            {
              absolutePath: resolve(dataRoot.path, "diagram.png"),
              id: resourceId,
              originalUrl: "diagram.png",
              relativePath: "diagram.png",
            },
          ],
        },
        versionId: "ver_candidate_0001",
      });

      expect(renderPage).toHaveBeenCalledTimes(book.pages.length);
      expect(result).toMatchObject({
        manifestPageCount: 2,
        pageCount: 2,
        searchFtsRowCount: 6,
        searchShortRowCount: 4,
      });
      const preview = await readFile(
        resolve(candidateDirectory, "preview/pages/1.html"),
        "utf8",
      );
      const published = await readFile(
        resolve(candidateDirectory, "published/pages/1.html"),
        "utf8",
      );
      const secondPreview = await readFile(
        resolve(candidateDirectory, "preview/pages/2.html"),
        "utf8",
      );
      expect(normalizedArticle(preview)).toBe(normalizedArticle(published));
      expect(preview).toContain('<span class="heading-number">1 </span>First');
      expect(secondPreview).toContain(
        `data-reader-page-owner="${headingIds[1]}"`,
      );
      expect(secondPreview).toContain(
        '<span class="heading-number">2 </span>Second',
      );
      expect(preview).toContain('data-reader-mode="preview"');
      expect(preview).not.toContain('rel="canonical"');
      expect(preview).not.toContain("reader-book-search");
      expect(preview).toContain(
        `/api/manage/books/7/preview/3/assets/${resourceId}`,
      );
      expect(published).toContain('data-reader-mode="published"');
      expect(published).toContain('<link rel="canonical" href="/read/7/1">');
      expect(published).toContain(
        `/books/7/assets/ver_candidate_0001/${resourceId}`,
      );
      expect(preview).not.toContain("/__mirawind__/");
      expect(published).not.toContain("/__mirawind__/");
      const signed = authorizePreviewHtmlResources({
        authSecret: "candidate-preview-secret",
        bookId: 7,
        html: preview,
        nowMs: 1_700_000_000_000,
        revision: 3,
        session: {
          authenticatedAtMs: 1_700_000_000_000,
          expiresAtMs: 1_700_003_600_000,
          sessionId: "session-candidate-preview",
          user: {
            email: "admin@example.test",
            id: "admin-candidate-preview",
            name: "Administrator",
          },
        },
      });
      expect(signed).toContain(`${resourceId}?authorization=`);
      expect(responsePolicyFor("draft")).toEqual({
        cacheControl: "private, no-store",
        robotsTag: "noindex, nofollow, noarchive, nosnippet",
      });

      const manifestLines = (
        await readFile(
          resolve(candidateDirectory, "derived/manifest-pages.ndjson"),
          "utf8",
        )
      )
        .trim()
        .split("\n");
      const searchLines = (
        await readFile(
          resolve(candidateDirectory, "derived/search-rows.ndjson"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(manifestLines).toHaveLength(2);
      expect(searchLines).toHaveLength(
        result.searchFtsRowCount + result.searchShortRowCount,
      );
      expect(
        manifestLines.map(
          (line) => JSON.parse(line) as Record<string, unknown>,
        ),
      ).toEqual(
        book.pages.map((page) => ({
          kind: "manifest_page",
          page: buildManifestPageRecord(book, page),
        })),
      );
      const expectedSearch = buildSearchSpool({
        authors: ["Author"],
        book,
        bookId: 7,
        title: "Candidate Preview",
        versionId: "ver_candidate_0001",
      });
      expect(
        searchLines
          .filter((line) => line.kind === "fts")
          .map((line) => line.row),
      ).toEqual(expectedSearch.ftsRows);
      expect(
        searchLines
          .filter((line) => line.kind === "short")
          .map((line) => line.row),
      ).toEqual(expectedSearch.shortRows);
    } finally {
      await dataRoot.cleanup();
    }
  });
});
