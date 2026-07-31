import { describe, expect, it } from "vitest";

import { renderReaderShell } from "@/web/features/reader/render";
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

describe("reader loop", () => {
  it("uses current presentation title and canonical key without draft leakage", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const fixture = setupPublicationFixture(database);
      database
        .prepare(
          `UPDATE book_version_presentations
           SET alias = 'reader-book', title = 'Published Reader'
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
          "UPDATE books SET title_cache = 'Unpublished Reader' WHERE id = ?",
        )
        .run(fixture.book.id);
      const book = new PublishedBookService(
        database,
        dataRoot.layout,
      ).resolveCurrent("reader-book", anonymous);
      const html = renderReaderShell({
        bodyHtml: "<p>Body</p>",
        bookKey: book.alias ?? String(book.bookId),
        bookTitle: book.title,
        currentTocHeadingId: null,
        currentPageId: 1,
        firstPageHref: "/read/reader-book/1",
        nextHref: null,
        originalDownloads: [],
        outline: [],
        pageOwnerHeadingId: null,
        previousHref: null,
        toc: [],
      });
      expect(html).toContain("Published Reader");
      expect(html).toContain("/api/books/reader-book/search");
      expect(html).not.toContain("Unpublished Reader");
    }));

  it("hides the current reader immediately after a public-to-private transition", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const fixture = setupPublicationFixture(database);
      await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });
      database
        .prepare("UPDATE books SET access = 'private' WHERE id = ?")
        .run(fixture.book.id);
      expect(() =>
        new PublishedBookService(database, dataRoot.layout).resolveCurrent(
          String(fixture.book.id),
          anonymous,
        ),
      ).toThrow(expect.objectContaining({ code: "NOT_FOUND", status: 404 }));
    }));
});
