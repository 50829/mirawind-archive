import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { MarkdownCandidate } from "@/modules/publishing/adapters/filesystem/discover-markdown-candidates";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { finalizePreparedDraft } from "@/modules/publishing/adapters/worker/finalize-prepared-draft";
import { prepareDraft } from "@/modules/publishing/adapters/worker/prepare-draft";
import { parseBookConfigYaml } from "@/modules/publishing/core/publication/book-config-schema";
import { queueSourceReprocess } from "@/modules/publishing/adapters/filesystem/source-reprocess";

import { buildZip } from "../../../scripts/fixtures/zip-builder.js";
import { withMigratedTestDatabase } from "../../helpers/database.js";

const candidate: MarkdownCandidate = Object.freeze({
  byteSize: 100,
  companionFiles: Object.freeze([]),
  confidence: "high",
  diagnostics: Object.freeze([]),
  firstHeading: "第一章",
  id: "cand_reprocess_initial_0001",
  normalizedPath: "wrapper/book.md",
  referencedResources: 0,
  score: 100,
});

describe("explicit source typography reprocessing", () => {
  it("creates a new source and v3 config revision without mutating the old snapshot", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const markdown = "# 第一章\n\n中文English,测试。\n";
      const archivePath = resolve(dataRoot.path, "initial.zip");
      await writeFile(
        archivePath,
        buildZip({
          entries: [{ data: markdown, name: candidate.normalizedPath }],
        }),
      );
      const imports = new ImportRepository(database);
      const drafts = new DraftRepository(database);
      const book = drafts.createBook({ nowMs: 1, title: "Pending" });
      const initialImport = imports.createUploaded({
        bookId: book.id,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
        id: "imp_reprocess_initial_0001",
        nowMs: 2,
        uploadRelativePath:
          "tmp/uploads/imp_reprocess_initial_0001/original.zip",
        uploadSha256: "a".repeat(64),
        uploadSizeBytes: (await readFile(archivePath)).byteLength,
      });
      imports.startAnalysis(initialImport.id, 3);
      imports.saveCandidates({
        candidates: [candidate],
        importId: initialImport.id,
        nextState: "preparing",
        nowMs: 4,
        selectedCandidateId: candidate.id,
      });
      const initialPrepared = await prepareDraft({
        archivePath,
        selectedCandidatePath: candidate.normalizedPath,
        stagingDirectory: resolve(dataRoot.path, "staging/initial"),
        typographyProfile: "verbatim-v1",
      });
      const initial = await finalizePreparedDraft({
        artifact: initialPrepared.artifact,
        database,
        extractedRoot: initialPrepared.extractedRoot,
        importId: initialImport.id,
        layout: dataRoot.layout,
        nowMs: 5,
        originalArchivePath: archivePath,
      });
      const oldMarkdownPath = resolve(
        dataRoot.layout.root,
        initial.snapshot.source.sourceRootRelativePath,
        initial.snapshot.source.mainMarkdownPath,
      );
      expect(await readFile(oldMarkdownPath, "utf8")).toBe(markdown);

      const queued = await queueSourceReprocess({
        bookId: book.id,
        database,
        expectedConfigRevision: 1,
        layout: dataRoot.layout,
        nowMs: 6,
        profile: "zh-smart-v1",
      });
      const reprocessImport = imports.require(queued.importId);
      const reprocessCandidate = imports
        .candidates(queued.importId)
        .find((value) => value.id === reprocessImport.selectedCandidateId);
      if (!reprocessCandidate) throw new Error("Reprocess candidate missing");
      expect(queued.job).toMatchObject({
        capturedConfigRevision: 1,
        capturedSourceId: initial.snapshot.source.id,
        kind: "prepare_draft",
        state: "queued",
      });

      const reprocessed = await prepareDraft({
        archivePath: resolve(
          dataRoot.layout.root,
          reprocessImport.uploadRelativePath,
        ),
        selectedCandidatePath: reprocessCandidate.normalizedPath,
        stagingDirectory: resolve(dataRoot.path, "staging/reprocess"),
        typographyProfile: "zh-smart-v1",
      });
      const finalized = await finalizePreparedDraft({
        artifact: reprocessed.artifact,
        database,
        extractedRoot: reprocessed.extractedRoot,
        importId: reprocessImport.id,
        layout: dataRoot.layout,
        nowMs: 7,
        originalArchivePath: resolve(
          dataRoot.layout.root,
          reprocessImport.uploadRelativePath,
        ),
      });
      const current = drafts.requireBook(book.id);
      const configRecord = drafts.requireConfig(book.id, 2);
      const config = parseBookConfigYaml(
        await readFile(
          resolve(dataRoot.layout.root, configRecord.yamlRelativePath),
          "utf8",
        ),
      );
      const normalizedMarkdown = await readFile(
        resolve(
          dataRoot.layout.root,
          finalized.snapshot.source.sourceRootRelativePath,
          finalized.snapshot.source.mainMarkdownPath,
        ),
        "utf8",
      );

      expect(normalizedMarkdown).toContain("中文 English，测试。");
      expect(await readFile(oldMarkdownPath, "utf8")).toBe(markdown);
      expect(finalized.snapshot.source.id).not.toBe(initial.snapshot.source.id);
      expect(current).toMatchObject({
        currentVersionId: null,
        draftConfigRevision: 2,
        draftSourceId: finalized.snapshot.source.id,
        readyPreviewRevision: null,
      });
      expect(config).toMatchObject({
        revision: 2,
        schema_version: 3,
        source: {
          main_markdown_sha256: finalized.snapshot.source.mainMarkdownSha256,
          preprocessing: {
            typography: {
              profile: "zh-smart-v1",
            },
          },
        },
      });
      expect(drafts.requirePreview(book.id, 2)).toMatchObject({
        sourceId: finalized.snapshot.source.id,
        state: "building",
      });
      await expect(
        queueSourceReprocess({
          bookId: book.id,
          database,
          expectedConfigRevision: 1,
          layout: dataRoot.layout,
          nowMs: 8,
          profile: "verbatim-v1",
        }),
      ).rejects.toMatchObject({ code: "REPROCESS_PRECONDITION_FAILED" });

      const revertQueued = await queueSourceReprocess({
        bookId: book.id,
        database,
        expectedConfigRevision: 2,
        layout: dataRoot.layout,
        nowMs: 9,
        profile: "verbatim-v1",
      });
      const revertImport = imports.require(revertQueued.importId);
      const revertCandidate = imports
        .candidates(revertImport.id)
        .find((value) => value.id === revertImport.selectedCandidateId);
      if (!revertCandidate) throw new Error("Verbatim candidate missing");
      const reverted = await prepareDraft({
        archivePath: resolve(
          dataRoot.layout.root,
          revertImport.uploadRelativePath,
        ),
        selectedCandidatePath: revertCandidate.normalizedPath,
        stagingDirectory: resolve(dataRoot.path, "staging/revert"),
        typographyProfile: "verbatim-v1",
      });
      const revertedFinal = await finalizePreparedDraft({
        artifact: reverted.artifact,
        database,
        extractedRoot: reverted.extractedRoot,
        importId: revertImport.id,
        layout: dataRoot.layout,
        nowMs: 10,
        originalArchivePath: resolve(
          dataRoot.layout.root,
          revertImport.uploadRelativePath,
        ),
      });
      const revertedMarkdown = await readFile(
        resolve(
          dataRoot.layout.root,
          revertedFinal.snapshot.source.sourceRootRelativePath,
          revertedFinal.snapshot.source.mainMarkdownPath,
        ),
        "utf8",
      );

      expect(revertedMarkdown).toBe(markdown);
      expect(await readFile(oldMarkdownPath, "utf8")).toBe(markdown);
      expect(
        await readFile(
          resolve(
            dataRoot.layout.root,
            finalized.snapshot.source.sourceRootRelativePath,
            finalized.snapshot.source.mainMarkdownPath,
          ),
          "utf8",
        ),
      ).toBe(normalizedMarkdown);
      expect(drafts.requireBook(book.id)).toMatchObject({
        draftConfigRevision: 3,
        draftSourceId: revertedFinal.snapshot.source.id,
      });
      expect(
        parseBookConfigYaml(
          await readFile(
            resolve(
              dataRoot.layout.root,
              drafts.requireConfig(book.id, 3).yamlRelativePath,
            ),
            "utf8",
          ),
        ),
      ).toMatchObject({
        revision: 3,
        source: {
          preprocessing: { typography: { profile: "verbatim-v1" } },
        },
      });
    }));
});
