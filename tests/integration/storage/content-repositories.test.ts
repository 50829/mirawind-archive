import { describe, expect, it } from "vitest";
import type { MineruCandidate } from "@/modules/publishing/adapters/filesystem/discover-mineru-candidates";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { withMigratedTestDatabase } from "../../helpers/database";

const candidate: MineruCandidate = {
  byteSize: 123,
  companionFiles: [],
  confidence: "high",
  diagnostics: [],
  firstHeading: "Book",
  id: "cand_abcdefghijklmnop",
  normalizedPath: "nested/content_list_v2.json",
  referencedResources: 0,
  score: 100,
};
describe("IR import and draft repositories", () => {
  it("guards the selected v2 import and scopes its jobs to the prepared book", () =>
    withMigratedTestDatabase(({ database }) => {
      const drafts = new DraftRepository(database),
        imports = new ImportRepository(database),
        jobs = new JobRepository(database);
      const imported = imports.createUploaded({
        expiresAtMs: 10000,
        nowMs: 2,
        originalName: "book.zip",
        uploadRelativePath: "tmp/uploads/book.zip",
        uploadSha256: "a".repeat(64),
        uploadSizeBytes: 42,
      });
      const job = jobs.create({
        importId: imported.id,
        kind: "analyze_import",
        nowMs: 2,
      });
      expect(() =>
        imports.saveCandidates({
          candidates: [candidate],
          importId: imported.id,
          nextState: "preparing",
          nowMs: 3,
          selectedCandidateId: candidate.id,
        }),
      ).toThrow("IMPORT_STATE_CONFLICT");
      imports.startAnalysis(imported.id, 3);
      expect(() =>
        imports.saveCandidates({
          candidates: [candidate],
          importId: imported.id,
          nextState: "preparing",
          nowMs: 4,
          selectedCandidateId: "cand_missing000000000",
        }),
      ).toThrow("IMPORT_CANDIDATE_INVALID");
      expect(imports.candidates(imported.id)).toEqual([]);
      imports.saveCandidates({
        candidates: [candidate],
        importId: imported.id,
        nextState: "preparing",
        nowMs: 4,
        selectedCandidateId: candidate.id,
      });
      const book = drafts.createBook({ nowMs: 5, title: "Book" });
      imports.attachBookForPreparation({
        bookId: book.id,
        importId: imported.id,
        nowMs: 5,
      });
      expect(jobs.get(job.id)?.bookId).toBe(book.id);
      imports.attachPreparedBook({
        bookId: book.id,
        importId: imported.id,
        nowMs: 6,
      });
      expect(imports.require(imported.id).state).toBe("draft_ready");
      const built = new DraftCandidateRepository(database).createForDocument({
        bookId: book.id,
        importId: imported.id,
        sourceUpdatedAt: 1000,
        nowMs: 7,
      });
      expect(built).toMatchObject({ sourceUpdatedAt: 1000, state: "building" });
      expect(drafts.requireBook(book.id)).toMatchObject({
        currentCandidateId: built.attemptId,
        draftImportId: imported.id,
        access: "private",
        currentVersionId: null,
      });
    }));
});
