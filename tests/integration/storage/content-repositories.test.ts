import { describe, expect, it } from "vitest";

import type { MarkdownCandidate } from "@/compiler/document/candidate-discovery";
import { DraftRepository } from "@/db/repositories/drafts";
import { ImportRepository } from "@/db/repositories/imports";
import { JobRepository } from "@/db/repositories/jobs";
import { SourceRepository } from "@/db/repositories/sources";

import { withMigratedTestDatabase } from "../../helpers/database.js";

const sha256 = "a".repeat(64);

function candidate(): MarkdownCandidate {
  return Object.freeze({
    byteSize: 123,
    companionFiles: Object.freeze(["layout.json"]),
    confidence: "generic",
    diagnostics: Object.freeze([]),
    firstHeading: "Book",
    id: "cand_abcdefghijklmnop",
    normalizedPath: "nested/book.md",
    referencedResources: 1,
    score: 50,
  });
}

describe("M1 import, source and draft repositories", () => {
  it("persists the guarded import candidate workflow", () =>
    withMigratedTestDatabase(({ database }) => {
      const drafts = new DraftRepository(database);
      const imports = new ImportRepository(database);
      const book = drafts.createBook({ nowMs: 1, title: "Pending import" });
      const created = imports.createUploaded({
        bookId: book.id,
        expiresAtMs: 10_000,
        id: "imp_abcdefghijklmnop",
        nowMs: 2,
        uploadRelativePath: "imports/imp_abcdefghijklmnop/original.zip",
        uploadSha256: sha256,
        uploadSizeBytes: 42,
      });

      expect(created.state).toBe("uploaded");
      expect(imports.startAnalysis(created.id, 3).state).toBe("analyzing");
      expect(
        imports.saveCandidates({
          candidates: [candidate()],
          importId: created.id,
          nextState: "needs_main_confirmation",
          nowMs: 4,
          selectedCandidateId: null,
        }),
      ).toMatchObject({
        selectedCandidateId: null,
        state: "needs_main_confirmation",
      });
      expect(imports.candidates(created.id)).toEqual([
        expect.objectContaining({
          evidence: {
            byteSize: 123,
            companionFiles: ["layout.json"],
            firstHeading: "Book",
            referencedResources: 1,
          },
          normalizedPath: "nested/book.md",
        }),
      ]);
      expect(
        imports.confirmCandidate({
          candidateId: candidate().id,
          importId: created.id,
          nowMs: 5,
        }),
      ).toMatchObject({
        selectedCandidateId: candidate().id,
        state: "preparing",
      });
      expect(() =>
        imports.confirmCandidate({
          candidateId: candidate().id,
          importId: created.id,
          nowMs: 6,
        }),
      ).toThrow("IMPORT_CONFIRMATION_CONFLICT");
    }));

  it("indexes immutable source, original, config and preview records", () =>
    withMigratedTestDatabase(({ database }) => {
      const drafts = new DraftRepository(database);
      const imports = new ImportRepository(database);
      const sources = new SourceRepository(database);
      const jobs = new JobRepository(database);
      const book = drafts.createBook({ nowMs: 1, title: "Book" });
      const importRecord = imports.createUploaded({
        bookId: book.id,
        expiresAtMs: 10_000,
        id: "imp_abcdefghijklmnop",
        nowMs: 2,
        uploadRelativePath: "imports/imp_abcdefghijklmnop/original.zip",
        uploadSha256: sha256,
        uploadSizeBytes: 42,
      });
      const source = sources.createSnapshot({
        analysisVersion: "candidate-v1",
        bookId: book.id,
        createdFromImportId: importRecord.id,
        id: "src_abcdefghijklmnop",
        mainMarkdownPath: "book.md",
        mainMarkdownSha256: sha256,
        nowMs: 3,
        sourceRootRelativePath: "books/1/sources/src_abcdefghijklmnop",
      });
      const original = sources.registerOriginal({
        bookId: book.id,
        id: "file_abcdefghijklmnop",
        mediaType: "application/zip",
        nowMs: 3,
        originalName: "upload.zip",
        sha256,
        sizeBytes: 42,
        sourceId: source.id,
        storageRelativePath: "books/1/originals/file_abcdefghijklmnop.zip",
      });
      const config = drafts.addConfigRevision({
        bookId: book.id,
        nowMs: 4,
        revision: 1,
        schemaVersion: 3,
        sourceId: source.id,
        title: "Ready book",
        yamlRelativePath: "books/1/config/1/book.yaml",
        yamlSha256: sha256,
      });
      const job = jobs.create({
        bookId: book.id,
        capturedConfigRevision: config.revision,
        capturedSourceId: source.id,
        kind: "build_preview",
        nowMs: 5,
      });
      drafts.createPreview({
        bookId: book.id,
        configRevision: config.revision,
        jobId: job.id,
        sourceId: source.id,
      });
      const preview = drafts.completePreview({
        bookId: book.id,
        configRevision: config.revision,
        diagnosticsRelativePath: "books/1/previews/1/diagnostics.json",
        nowMs: 6,
        previewRelativePath: "books/1/previews/1",
      });

      expect(sources.requireSnapshot(source.id)).toEqual(source);
      expect(sources.requireOriginal(original.id)).toEqual(original);
      expect(drafts.requireConfig(book.id, 1)).toEqual(config);
      expect(preview).toMatchObject({ completedAtMs: 6, state: "ready" });
      expect(drafts.requireBook(book.id)).toMatchObject({
        draftConfigRevision: 1,
        draftSourceId: source.id,
        readyPreviewRevision: 1,
        title: "Ready book",
      });
      expect(() =>
        drafts.addConfigRevision({
          bookId: book.id,
          nowMs: 7,
          revision: 1,
          schemaVersion: 3,
          sourceId: source.id,
          title: "Mutated",
          yamlRelativePath: "other.yaml",
          yamlSha256: sha256,
        }),
      ).toThrow();
      expect(drafts.requireConfig(book.id, 1)).toEqual(config);
    }));
});
