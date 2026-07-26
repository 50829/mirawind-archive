import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import { detectPrintedContents } from "@/compiler/document/printed-toc";
import { proposeDocumentStructure } from "@/compiler/document/structure-proposal";
import { buildImmutableVersion } from "@/compiler/version-builder";
import { buildPreview } from "@/jobs/handlers/build-preview";
import { validateBookConfig } from "@/schemas/book-config";

import { createTemporaryDataRoot } from "../../helpers/data-root.js";

const fixturePath = fileURLToPath(
  new URL("../../fixtures/publishing-quality/printed-toc.md", import.meta.url),
);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("preview and publication semantic parity", () => {
  it("emits the same filtered pages, headings, numbering, diagnostics and digest", async () => {
    const dataRoot = await createTemporaryDataRoot("preview-parity");
    try {
      const bookId = 1;
      const sourceId = "src_preview_parity_000001";
      const versionId = "ver_preview_parity_000001";
      const draftRoot = resolve(
        dataRoot.layout.bookDirectory,
        String(bookId),
        "draft",
      );
      const sourceRoot = resolve(draftRoot, "sources", sourceId);
      await mkdir(sourceRoot, { mode: 0o700, recursive: true });
      const markdown = await readFile(fixturePath, "utf8");
      await writeFile(resolve(sourceRoot, "book.md"), markdown);
      const sourceSha256 = sha256(markdown);
      let ordinal = 0;
      const proposed = normalizeDocumentBlocks(
        parseMarkdownDocument(markdown),
        {
          idFactory: () => `blk_${String(++ordinal).padStart(20, "0")}`,
        },
      );
      const regions = detectPrintedContents({
        document: proposed,
        idFactory: () => "region_abcdefghijklmnop",
        sourcePath: "book.md",
        sourceSha256,
      }).candidates.flatMap((candidate) =>
        candidate.proposedRegion ? [candidate.proposedRegion] : [],
      );
      const config = validateBookConfig({
        book_id: bookId,
        publishing: {
          code: { line_numbers: false },
          numbering: { mode: "normalized" },
        },
        revision: 1,
        schema_version: 3,
        source: {
          main_markdown: "book.md",
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
        source_regions: regions,
        structure: proposeDocumentStructure(proposed, {
          sourceRegions: regions,
        }).nodes,
        title: "机器学习",
      });
      const configYaml = stringify(config, { lineWidth: 0 });
      const configPath = resolve(draftRoot, "configs", "1", "book.yaml");
      await mkdir(resolve(configPath, ".."), { mode: 0o700, recursive: true });
      await writeFile(configPath, configYaml);

      const previewStaging = resolve(
        dataRoot.layout.temporaryDirectory,
        "preview",
      );
      const versionStaging = resolve(
        dataRoot.layout.temporaryDirectory,
        "version",
      );
      const previewArtifact = await buildPreview({
        bookId,
        configRevision: 1,
        configYamlPath: configPath,
        sourceRoot,
        stagingDirectory: previewStaging,
      });
      const versionArtifact = await buildImmutableVersion({
        bookId,
        configRevision: 1,
        configYamlPath: configPath,
        createdAtMs: 1_753_315_200_000,
        draftRoot,
        predecessorVersionId: null,
        sourceId,
        sourceRoot,
        stagingDirectory: versionStaging,
        versionId,
      });
      const previewModel = JSON.parse(
        await readFile(
          resolve(previewStaging, "preview", "preview-model.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const diagnostics = JSON.parse(
        await readFile(
          resolve(previewStaging, "preview", "diagnostics.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const manifest = JSON.parse(
        await readFile(
          resolve(versionStaging, "version", "document-manifest.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const previewPages = previewModel.pages as readonly Record<
        string,
        unknown
      >[];
      const publishedPages = manifest.pages as readonly Record<
        string,
        unknown
      >[];
      const previewHeadings = previewModel.headings as readonly Record<
        string,
        unknown
      >[];
      const publishedToc = manifest.toc as readonly Record<string, unknown>[];

      expect(previewArtifact.identity).toEqual(versionArtifact.identity);
      expect(previewModel.semantic_digest).toBe(
        versionArtifact.identity.semantic_digest,
      );
      expect(
        previewPages.map(({ page_id, title }) => ({ page_id, title })),
      ).toEqual(
        publishedPages.map(({ page_id, title }) => ({ page_id, title })),
      );
      expect(
        previewHeadings.map(({ block_id, display_level, number, title }) => ({
          block_id,
          display_level,
          number,
          title,
        })),
      ).toEqual(
        publishedToc.map(({ block_id, level, number, title }) => ({
          block_id,
          display_level: level,
          number,
          title,
        })),
      );
      expect(diagnostics).toEqual({ diagnostics: [] });
      expect(previewPages).toHaveLength(2);
      const previewHtml = await Promise.all(
        previewPages.map((page) =>
          readFile(
            resolve(
              previewStaging,
              "preview",
              "pages",
              `${String(page.page_id)}.html`,
            ),
            "utf8",
          ),
        ),
      );
      expect(previewHtml.join("\n")).not.toContain("...... 1");
    } finally {
      await dataRoot.cleanup();
    }
  });
});
