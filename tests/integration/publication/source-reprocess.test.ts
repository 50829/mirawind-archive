import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { MarkdownCandidate } from "@/compiler/document/candidate-discovery";
import { DraftRepository } from "@/db/repositories/drafts";
import { ImportRepository } from "@/db/repositories/imports";
import {
  finalizePreparedDraft,
  prepareDraft,
} from "@/jobs/handlers/prepare-draft";
import { parseBookConfigYaml } from "@/schemas/book-config";
import { queueSourceReprocess } from "@/services/source-reprocess";

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
    }));
});
