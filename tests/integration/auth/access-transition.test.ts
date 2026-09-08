import { describe, expect, it } from "vitest";

import { SqliteBookAccessRepository } from "@/modules/catalog/adapters/sqlite/book-access";
import { setBookAccess } from "@/modules/catalog/application/commands/set-book-access";
import { normalizeSearchQuery } from "@/modules/reader/core/search-query";
import { BookSearchRepository } from "@/modules/reader/adapters/sqlite/book-search";
import { PublishedBookService } from "@/modules/reader/adapters/filesystem/published-book";

import { withMigratedTestDatabase } from "../../helpers/database.js";
import {
  publishReadyCandidateForTest,
  publicationTestVersionId,
  setupPublicationFixture,
} from "../../helpers/publication.js";

const anonymous = {
  allowed: false,
  reason: "UNAUTHENTICATED",
} as const;
const administrator = { allowed: true } as const;

describe("immediate public-to-private transition", () => {
  it("rejects public access before a version is published", () =>
    withMigratedTestDatabase(({ database }) => {
      const fixture = setupPublicationFixture(database);
      expect(() =>
        setBookAccess({
          access: "public",
          actorUserId: "admin",
          bookId: fixture.book.id,
          books: new SqliteBookAccessRepository(database),
          nowMs: 10,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "BOOK_PUBLICATION_REQUIRED",
          status: 409,
        }),
      );
      expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
        access: "private",
        currentVersionId: null,
      });
    }));

  it("denies new anonymous read, search and original resolution without rebuilding", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const fixture = setupPublicationFixture(database);
      const fileId = "file_visibility_transition_0001";
      database
        .prepare(
          `INSERT INTO original_files (
             id, book_id, import_id, role, storage_rel_path, original_name,
             media_type, size_bytes, sha256, created_at
           ) VALUES (?, ?, ?, 'mineru_zip', ?, 'mineru.zip',
                     'application/zip', 1, ?, 11)`,
        )
        .run(
          fileId,
          fixture.book.id,
          fixture.imported.id,
          `originals/${fileId}`,
          "a".repeat(64),
        );
      await publishReadyCandidateForTest({
        access: "private",
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });
      const service = new PublishedBookService(database, dataRoot.layout);
      expect(() =>
        service.resolveCurrent(String(fixture.book.id), anonymous),
      ).toThrow(expect.objectContaining({ code: "NOT_FOUND", status: 404 }));

      setBookAccess({
        access: "public",
        actorUserId: "admin",
        bookId: fixture.book.id,
        books: new SqliteBookAccessRepository(database),
        nowMs: 13,
      });
      expect(
        service.resolveCurrent(String(fixture.book.id), anonymous),
      ).toMatchObject({ access: "public" });
      expect(
        service.resolveOriginal({
          administrator: anonymous,
          bookKey: String(fixture.book.id),
          fileId,
        }),
      ).toMatchObject({ fileId });

      setBookAccess({
        access: "private",
        actorUserId: "admin",
        bookId: fixture.book.id,
        books: new SqliteBookAccessRepository(database),
        nowMs: 14,
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
        access: "private",
      });
      expect(fixture.drafts.requireBook(fixture.book.id).currentVersionId).toBe(
        publicationTestVersionId,
      );
    }));
});
