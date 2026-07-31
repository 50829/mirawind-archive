import { describe, expect, it } from "vitest";

import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { LibraryService } from "@/modules/catalog/adapters/sqlite/library";

import { withMigratedTestDatabase } from "../../helpers/database.js";
import {
  publishReadyCandidateForTest,
  publicationTestVersionId,
  setupPublicationFixture,
} from "../../helpers/publication.js";

describe("library service", () => {
  it("lists only public current projections and never leaks draft metadata", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      database
        .prepare(
          `UPDATE book_version_presentations
           SET alias = 'frozen-book',
               metadata_json = '{"authors":["A. Reader"],"language":"zh-CN"}'
           WHERE version_id = ?`,
        )
        .run(publicationTestVersionId);
      await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });
      database
        .prepare(
          "UPDATE books SET title_cache = 'Secret draft title' WHERE id = ?",
        )
        .run(fixture.book.id);
      new DraftRepository(database).createBook({
        nowMs: 13,
        title: "Hidden draft",
      });

      const result = new LibraryService(database).publicLibrary();

      expect(result.entries).toEqual([
        expect.objectContaining({
          authors: ["A. Reader"],
          bookKey: "frozen-book",
          detailsUrl: "/books/frozen-book",
          startUrl: "/read/frozen-book/1",
          title: "Book",
          versionId: publicationTestVersionId,
        }),
      ]);
      expect(JSON.stringify(result)).not.toContain("Secret");
      expect(JSON.stringify(result)).not.toContain("Hidden");
      expect(result.hasUnavailableBooks).toBe(false);
    }));

  it("reports an anonymous partial state when a public current projection is missing", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });
      database
        .prepare("DELETE FROM book_version_presentations WHERE version_id = ?")
        .run(publicationTestVersionId);

      const result = new LibraryService(database).publicLibrary();

      expect(result.entries).toEqual([]);
      expect(result.hasUnavailableBooks).toBe(true);
      expect(JSON.stringify(result)).not.toContain(String(fixture.book.id));
    }));

  it("returns bounded administrator lifecycle entries separately", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      const draft = new DraftRepository(database).createBook({
        nowMs: 20,
        title: "Draft work",
      });

      const page = new LibraryService(database).administratorLibrary({
        afterBookId: null,
        limit: 1,
      });

      expect(page.entries).toHaveLength(1);
      expect(page.nextBookId).toBe(fixture.book.id);
      const second = new LibraryService(database).administratorLibrary({
        afterBookId: page.nextBookId,
        limit: 100,
      });
      expect(second.entries).toEqual([
        expect.objectContaining({
          bookId: draft.id,
          currentVersionAvailable: false,
          managementHref: `/manage/books/${draft.id}`,
          readingHref: null,
          statusLabel: "草稿",
          title: "Draft work",
        }),
      ]);
    }));
});
