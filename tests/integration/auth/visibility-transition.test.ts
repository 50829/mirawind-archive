import { describe, expect, it } from "vitest";

import { normalizeSearchQuery } from "@/modules/reader/core/search-query";
import { BookSearchRepository } from "@/modules/reader/adapters/sqlite/book-search";
import {
  makeBookNonPublic,
  publishReadyVersion,
} from "@/modules/publishing/adapters/sqlite/publication";
import { PublishedBookService } from "@/modules/reader/adapters/filesystem/published-book";

import { withMigratedTestDatabase } from "../../helpers/database.js";
import {
  publicationTestLeaseOwner,
  publicationTestVersionId,
  setupPublicationFixture,
} from "../publication/stale-build.test.js";

const anonymous = {
  allowed: false,
  reason: "UNAUTHENTICATED",
} as const;
const administrator = { allowed: true } as const;

describe("immediate public-to-private transition", () => {
  it("denies new anonymous read, search and original resolution without rebuilding", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const fixture = setupPublicationFixture(database);
      const source = database
        .prepare("SELECT source_id FROM book_versions WHERE id = ?")
        .get(publicationTestVersionId) as { source_id: string };
      const fileId = "file_visibility_transition_0001";
      database
        .prepare(
          `INSERT INTO original_files (
             id, book_id, source_id, role, storage_rel_path, original_name,
             media_type, size_bytes, sha256, created_at
           ) VALUES (?, ?, ?, 'mineru_zip', ?, 'mineru.zip',
                     'application/zip', 1, ?, 11)`,
        )
        .run(
          fileId,
          fixture.book.id,
          source.source_id,
          `originals/${fileId}`,
          "a".repeat(64),
        );
      await publishReadyVersion({
        actorUserId: null,
        database,
        jobId: fixture.publishJob.id,
        leaseOwner: publicationTestLeaseOwner,
        nowMs: 12,
        versionId: publicationTestVersionId,
      });
      const service = new PublishedBookService(database, dataRoot.layout);
      expect(
        service.resolveCurrent(String(fixture.book.id), anonymous),
      ).toMatchObject({ visibility: "public" });
      expect(
        service.resolveOriginal({
          administrator: anonymous,
          bookKey: String(fixture.book.id),
          fileId,
        }),
      ).toMatchObject({ fileId });

      makeBookNonPublic({
        actorUserId: "admin",
        bookId: fixture.book.id,
        database,
        nowMs: 13,
        visibility: "private",
      });
      expect(() =>
        service.resolveCurrent(String(fixture.book.id), anonymous),
      ).toThrow(expect.objectContaining({ code: "NOT_FOUND", status: 404 }));
      expect(() =>
        service.resolveOriginal({
          administrator: anonymous,
          bookKey: String(fixture.book.id),
          fileId,
        }),
      ).toThrow(expect.objectContaining({ code: "NOT_FOUND", status: 404 }));
      expect(
        new BookSearchRepository(database).search({
          bookId: fixture.book.id,
          bookKey: String(fixture.book.id),
          limit: 20,
          offset: 0,
          query: normalizeSearchQuery("Body"),
          requirePublic: true,
          versionId: publicationTestVersionId,
        }),
      ).toEqual([]);
      expect(
        service.resolveCurrent(String(fixture.book.id), administrator),
      ).toMatchObject({
        versionId: publicationTestVersionId,
        visibility: "private",
      });
      expect(fixture.drafts.requireBook(fixture.book.id).currentVersionId).toBe(
        publicationTestVersionId,
      );
    }));
});
