import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { MarkdownCandidate } from "@/compiler/document/candidate-discovery";
import { DraftRepository } from "@/db/repositories/drafts";
import { ImportRepository } from "@/db/repositories/imports";
import {
  buildPreview,
  finalizeBuiltPreview,
} from "@/jobs/handlers/build-preview";
import {
  finalizePreparedDraft,
  prepareDraft,
} from "@/jobs/handlers/prepare-draft";
import { parseBookConfigYaml } from "@/schemas/book-config";
import { buildZip } from "../../../scripts/fixtures/zip-builder";
import { withMigratedTestDatabase } from "../../helpers/database.js";

const sha256 = "a".repeat(64);

function candidate(): MarkdownCandidate {
  return Object.freeze({
    byteSize: 100,
    companionFiles: Object.freeze(["layout.json"]),
    confidence: "high",
    diagnostics: Object.freeze([]),
    firstHeading: "Prepared Book",
    id: "cand_abcdefghijklmnop",
    normalizedPath: "wrapper/full.md",
    referencedResources: 1,
    score: 100,
  });
}

describe("prepare_draft and build_preview handlers", () => {
  it("creates an immutable initial config and a revision-pinned ready preview", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const image = await sharp({
        create: {
          background: { alpha: 1, b: 3, g: 2, r: 1 },
          channels: 4,
          height: 2,
          width: 2,
        },
      })
        .png()
        .toBuffer();
      const archivePath = resolve(dataRoot.path, "input.zip");
      await writeFile(
        archivePath,
        buildZip({
          entries: [
            {
              data: [
                "# Prepared Book",
                "",
                "## Chapter",
                "",
                "Text with $x+1$.",
                "",
                "![figure](images/a.png)",
              ].join("\n"),
              name: "wrapper/full.md",
            },
            { data: "{}", name: "wrapper/layout.json" },
            { data: image, name: "wrapper/images/a.png" },
          ],
        }),
      );
      const drafts = new DraftRepository(database);
      const imports = new ImportRepository(database);
      const book = drafts.createBook({ nowMs: 1, title: "Pending import" });
      const imported = imports.createUploaded({
        bookId: book.id,
        expiresAtMs: 10_000,
        id: "imp_abcdefghijklmnop",
        nowMs: 2,
        uploadRelativePath: "tmp/uploads/imp_abcdefghijklmnop/original.zip",
        uploadSha256: sha256,
        uploadSizeBytes: (await readFile(archivePath)).byteLength,
      });
      imports.startAnalysis(imported.id, 3);
      imports.saveCandidates({
        candidates: [candidate()],
        importId: imported.id,
        nextState: "preparing",
        nowMs: 4,
        selectedCandidateId: candidate().id,
      });

      const prepared = await prepareDraft({
        archivePath,
        selectedCandidatePath: candidate().normalizedPath,
        stagingDirectory: resolve(
          dataRoot.path,
          "staging/job_prepare_abcdefghijklmnop",
        ),
      });
      const finalized = await finalizePreparedDraft({
        artifact: prepared.artifact,
        database,
        extractedRoot: prepared.extractedRoot,
        importId: imported.id,
        layout: dataRoot.layout,
        nowMs: 5,
        originalArchivePath: archivePath,
      });
      const config = drafts.requireConfig(book.id, 1);
      const configPath = resolve(dataRoot.layout.root, config.yamlRelativePath);
      const parsedConfig = parseBookConfigYaml(
        await readFile(configPath, "utf8"),
      );

      expect(parsedConfig).toMatchObject({
        book_id: book.id,
        revision: 1,
        schema_version: 1,
        structure: [
          expect.objectContaining({
            display_level: 1,
            include_in_toc: true,
            role: "body",
            starts_page: true,
          }),
          expect.objectContaining({
            display_level: 2,
            include_in_toc: true,
            starts_page: false,
          }),
        ],
        title: "Prepared Book",
      });
      expect(imports.require(imported.id)).toMatchObject({
        bookId: book.id,
        state: "draft_ready",
      });
      expect(finalized.previewJob).toMatchObject({
        capturedConfigRevision: 1,
        capturedSourceId: finalized.snapshot.source.id,
        kind: "build_preview",
        state: "queued",
      });
      expect(drafts.requirePreview(book.id, 1).state).toBe("building");

      const previewStaging = resolve(
        dataRoot.path,
        "staging/job_preview_abcdefghijklmnop",
      );
      const previewArtifact = await buildPreview({
        bookId: book.id,
        configRevision: 1,
        configYamlPath: configPath,
        sourceRoot: resolve(
          dataRoot.layout.root,
          finalized.snapshot.source.sourceRootRelativePath,
        ),
        stagingDirectory: previewStaging,
      });
      await finalizeBuiltPreview({
        artifact: previewArtifact,
        bookId: book.id,
        configRevision: 1,
        database,
        layout: dataRoot.layout,
        nowMs: 6,
        stagingDirectory: previewStaging,
      });
      const ready = drafts.requirePreview(book.id, 1);
      const previewRoot = resolve(
        dataRoot.layout.root,
        ready.previewRelativePath ?? "",
      );

      expect(ready).toMatchObject({ completedAtMs: 6, state: "ready" });
      expect(
        await readFile(resolve(previewRoot, "pages/1.html"), "utf8"),
      ).toMatch(/Prepared Book[\s\S]*class="katex"[\s\S]*\/assets\/res_/u);
      expect(
        JSON.parse(
          await readFile(resolve(previewRoot, "preview-model.json"), "utf8"),
        ),
      ).toMatchObject({
        config_revision: 1,
        headings: [
          { display_level: 1, role: "body", starts_page: true },
          { display_level: 2, role: "body", starts_page: false },
        ],
      });
    }));
});
