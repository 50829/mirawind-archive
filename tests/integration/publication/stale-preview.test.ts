import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { compilerIdentity } from "@/compiler/document/manifest";
import { DraftRepository } from "@/db/repositories/drafts";
import { ImportRepository } from "@/db/repositories/imports";
import { JobRepository } from "@/db/repositories/jobs";
import { SourceRepository } from "@/db/repositories/sources";
import {
  buildPreview,
  finalizeBuiltPreview,
} from "@/jobs/handlers/build-preview";
import { assertReadyPreviewIdentity } from "@/services/preview-identity";

import { withMigratedTestDatabase } from "../../helpers/database.js";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("ready preview publication identity", () => {
  it("rejects stale source, config, compiler, renderer and semantic identities", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const drafts = new DraftRepository(database);
      const book = drafts.createBook({ nowMs: 1, title: "Preview identity" });
      const imported = new ImportRepository(database).createUploaded({
        bookId: book.id,
        expiresAtMs: 1_000,
        id: "imp_preview_identity_0001",
        nowMs: 2,
        uploadRelativePath: "tmp/import.zip",
        uploadSha256: "a".repeat(64),
        uploadSizeBytes: 1,
      });
      const sourceId = "src_preview_identity_0001";
      const sourceRoot = resolve(
        dataRoot.layout.bookDirectory,
        String(book.id),
        "draft",
        "sources",
        sourceId,
      );
      await mkdir(sourceRoot, { mode: 0o700, recursive: true });
      const markdown = "# Chapter\n\nBody.";
      await writeFile(resolve(sourceRoot, "book.md"), markdown);
      const source = new SourceRepository(database).createSnapshot({
        analysisVersion: "test-v1",
        bookId: book.id,
        createdFromImportId: imported.id,
        id: sourceId,
        mainMarkdownPath: "book.md",
        mainMarkdownSha256: sha256(markdown),
        nowMs: 3,
        sourceRootRelativePath: `books/${book.id}/draft/sources/${sourceId}`,
      });
      const configValue = {
        book_id: book.id,
        publishing: {
          code: { line_numbers: false },
          numbering: { mode: "normalized" },
        },
        revision: 1,
        schema_version: 3,
        source: {
          main_markdown: "book.md",
          main_markdown_sha256: source.mainMarkdownSha256,
          original_files: [],
          preprocessing: {
            typography: {
              input_sha256: source.mainMarkdownSha256,
              output_sha256: source.mainMarkdownSha256,
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
            block_id: "blk_preview_identity_0001",
            display_level: 1,
            include_in_toc: true,
            role: "body",
            starts_page: true,
          },
        ],
        title: "Preview identity",
      };
      const configYaml = stringify(configValue, { lineWidth: 0 });
      const configPath = resolve(
        dataRoot.layout.bookDirectory,
        String(book.id),
        "draft",
        "configs",
        "1",
        "book.yaml",
      );
      await mkdir(resolve(configPath, ".."), { mode: 0o700, recursive: true });
      await writeFile(configPath, configYaml);
      const config = drafts.addConfigRevision({
        bookId: book.id,
        nowMs: 4,
        revision: 1,
        schemaVersion: 3,
        sourceId,
        title: "Preview identity",
        yamlRelativePath: `books/${book.id}/draft/configs/1/book.yaml`,
        yamlSha256: sha256(configYaml),
      });
      const previewJob = new JobRepository(database).create({
        bookId: book.id,
        capturedConfigRevision: 1,
        capturedSourceId: sourceId,
        kind: "build_preview",
        nowMs: 5,
      });
      drafts.createPreview({
        bookId: book.id,
        configRevision: 1,
        jobId: previewJob.id,
        sourceId,
      });
      const stagingDirectory = resolve(
        dataRoot.layout.temporaryDirectory,
        "preview-identity",
      );
      const artifact = await buildPreview({
        bookId: book.id,
        configRevision: 1,
        configYamlPath: configPath,
        sourceRoot,
        stagingDirectory,
      });
      await finalizeBuiltPreview({
        artifact,
        bookId: book.id,
        configRevision: 1,
        database,
        layout: dataRoot.layout,
        nowMs: 6,
        stagingDirectory,
      });
      const preview = drafts.requirePreview(book.id, 1);
      const current = drafts.requireBook(book.id);
      const input = {
        book: current,
        config,
        layout: dataRoot.layout,
        preview,
        source,
      };

      await expect(assertReadyPreviewIdentity(input)).resolves.toMatchObject({
        compiler_version: compilerIdentity.version,
        renderer_version: compilerIdentity.renderer_version,
      });
      const previewRoot = resolve(
        dataRoot.layout.root,
        preview.previewRelativePath ?? "",
      );
      const modelPath = resolve(previewRoot, "preview-model.json");
      const valid = JSON.parse(await readFile(modelPath, "utf8")) as Record<
        string,
        unknown
      >;
      for (const [field, value] of [
        ["source_sha256", "b".repeat(64)],
        ["config_sha256", "b".repeat(64)],
        ["compiler_version", "compiler-stale"],
        ["renderer_version", "renderer-stale"],
        ["semantic_digest", "invalid"],
      ] as const) {
        await writeFile(
          modelPath,
          `${JSON.stringify({ ...valid, [field]: value })}\n`,
        );
        await expect(assertReadyPreviewIdentity(input)).rejects.toMatchObject({
          code: "PUBLISH_PREVIEW_STALE",
        });
      }
    }));
});
