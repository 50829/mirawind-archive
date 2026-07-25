import { describe, expect, it } from "vitest";

import { renderReaderShell } from "@/components/reader/render";
import { PublishedBookService } from "@/services/published-book";
import { publishReadyVersion } from "@/services/publication";

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
      await publishReadyVersion({
        actorUserId: null,
        database,
        jobId: fixture.publishJob.id,
        leaseOwner: publicationTestLeaseOwner,
        nowMs: 12,
        versionId: publicationTestVersionId,
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
        currentPageId: 1,
        nextHref: null,
        originalDownloads: [],
        outline: [],
        pages: [{ href: "/read/reader-book/1", pageId: 1, title: "Page" }],
        previousHref: null,
      });
      expect(html).toContain("Published Reader");
      expect(html).toContain("/api/books/reader-book/search");
      expect(html).not.toContain("Unpublished Reader");
    }));

  it("hides the current reader immediately after a public-to-private transition", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const fixture = setupPublicationFixture(database);
      await publishReadyVersion({
        actorUserId: null,
        database,
        jobId: fixture.publishJob.id,
        leaseOwner: publicationTestLeaseOwner,
        nowMs: 12,
        versionId: publicationTestVersionId,
      });
      database
        .prepare("UPDATE books SET visibility = 'private' WHERE id = ?")
        .run(fixture.book.id);
      expect(() =>
        new PublishedBookService(database, dataRoot.layout).resolveCurrent(
          String(fixture.book.id),
          anonymous,
        ),
      ).toThrow(expect.objectContaining({ code: "NOT_FOUND", status: 404 }));
    }));
});
