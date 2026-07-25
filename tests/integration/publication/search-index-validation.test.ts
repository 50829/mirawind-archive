import { describe, expect, it } from "vitest";

import type { SearchSpool } from "@/compiler/search/build-spool";
import { DraftRepository } from "@/db/repositories/drafts";
import { ImportRepository } from "@/db/repositories/imports";
import { JobRepository } from "@/db/repositories/jobs";
import { SourceRepository } from "@/db/repositories/sources";
import { VersionRepository } from "@/db/repositories/versions";

import { withMigratedTestDatabase } from "../../helpers/database.js";
import { presentationForTest } from "./stale-build.test.js";

const hash = "a".repeat(64);
const sourceId = "src_search_index_test_0001";
const versionId = "ver_search_index_test_0001";
const secondVersionId = "ver_search_index_test_0002";
const blockId = "blk_search_index_test_0001";

function spool(input: {
  readonly bookId: number;
  readonly versionId: string;
}): SearchSpool {
  return {
    digest: hash,
    ftsRows: [
      {
        authors: "Author",
        blockId,
        body: "中文正文",
        bookId: input.bookId,
        heading: "Chapter",
        kind: "paragraph",
        ordinal: 0,
        pageId: 1,
        title: "Book",
        versionId: input.versionId,
      },
    ],
    schemaVersion: 1,
    shortRows: [
      {
        blockId: null,
        bookId: input.bookId,
        kind: "title",
        normalizedText: "Book",
        ordinal: 0,
        pageId: 1,
        versionId: input.versionId,
      },
    ],
  };
}

describe("ready-version and search index transaction", () => {
  it("validates row counts and exact block IDs and rolls everything back on failure", () =>
    withMigratedTestDatabase(({ database }) => {
      const drafts = new DraftRepository(database);
      const book = drafts.createBook({ nowMs: 1, title: "Book" });
      const imported = new ImportRepository(database).createUploaded({
        bookId: book.id,
        expiresAtMs: 10_000,
        id: "imp_search_index_test_0001",
        nowMs: 2,
        uploadRelativePath: "tmp/import.zip",
        uploadSha256: hash,
        uploadSizeBytes: 1,
      });
      new SourceRepository(database).createSnapshot({
        analysisVersion: "test-v1",
        bookId: book.id,
        createdFromImportId: imported.id,
        id: sourceId,
        mainMarkdownPath: "book.md",
        mainMarkdownSha256: hash,
        nowMs: 3,
        sourceRootRelativePath: "books/1/draft/sources/source",
      });
      drafts.addConfigRevision({
        bookId: book.id,
        nowMs: 4,
        revision: 1,
        schemaVersion: 1,
        sourceId,
        title: "Book",
        yamlRelativePath: "books/1/draft/configs/1/book.yaml",
        yamlSha256: hash,
      });
      const jobs = new JobRepository(database);
      const firstJob = jobs.create({
        bookId: book.id,
        capturedConfigRevision: 1,
        capturedSourceId: sourceId,
        kind: "build_publish",
        nowMs: 5,
      });
      const versions = new VersionRepository(database);
      const ready = versions.registerReadyWithSearch({
        bookId: book.id,
        compilerVersion: "compiler-v1",
        completeAtMs: 6,
        configRevision: 1,
        createdByJobId: firstJob.id,
        expectedSearchBlockIds: [blockId],
        manifestSchemaVersion: 1,
        manifestSha256: hash,
        predecessorVersionId: null,
        presentation: presentationForTest(book.id, versionId),
        rendererVersion: "semantic-html-v1",
        sourceId,
        spool: spool({ bookId: book.id, versionId }),
        versionId,
        versionRelativePath: `books/1/versions/${versionId}`,
      });
      expect(ready.state).toBe("ready");
      expect(jobs.get(firstJob.id)?.versionId).toBe(versionId);
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM search_fts WHERE version_id = ?",
          )
          .get(versionId),
      ).toEqual({ count: 1 });

      const secondJob = jobs.create({
        bookId: book.id,
        capturedConfigRevision: 1,
        capturedCurrentVersionId: versionId,
        capturedSourceId: sourceId,
        kind: "build_publish",
        nowMs: 7,
      });
      expect(() =>
        versions.registerReadyWithSearch({
          bookId: book.id,
          compilerVersion: "compiler-v1",
          completeAtMs: 8,
          configRevision: 1,
          createdByJobId: secondJob.id,
          expectedSearchBlockIds: ["blk_search_index_missing_0001"],
          manifestSchemaVersion: 1,
          manifestSha256: hash,
          predecessorVersionId: versionId,
          presentation: presentationForTest(book.id, secondVersionId),
          rendererVersion: "semantic-html-v1",
          sourceId,
          spool: spool({ bookId: book.id, versionId: secondVersionId }),
          versionId: secondVersionId,
          versionRelativePath: `books/1/versions/${secondVersionId}`,
        }),
      ).toThrow("SEARCH_BLOCK_ID_SET_MISMATCH");
      expect(versions.find(secondVersionId)).toBeNull();
      expect(jobs.get(secondJob.id)?.versionId).toBeNull();
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM search_fts WHERE version_id = ?",
          )
          .get(secondVersionId),
      ).toEqual({ count: 0 });
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM book_version_presentations WHERE version_id = ?`,
          )
          .get(secondVersionId),
      ).toEqual({ count: 0 });
    }));
});
