import { describe, expect, it } from "vitest";

import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { LibraryService } from "@/modules/catalog/adapters/sqlite/library";
import { publishReadyVersion } from "@/modules/publishing/adapters/sqlite/publication";

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

describe("book details service", () => {
  it("resolves frozen metadata, bounded TOC, canonical actions and originals", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      database
        .prepare(
          `UPDATE book_version_presentations
           SET alias = 'canonical-book',
               metadata_json = ?,
               toc_preview_json = ?,
               toc_entry_count = 2
           WHERE version_id = ?`,
        )
        .run(
          JSON.stringify({
            authors: ["A. Author"],
            description: "A stable description.",
            language: "en",
            subtitle: "A subtitle",
          }),
          JSON.stringify([
            {
              block_id: "blk_stale_publish_test_0001",
              level: 1,
              number: "1",
              page_id: 1,
              role: "body",
              title: "Opening",
            },
          ]),
          publicationTestVersionId,
        );
      await publishReadyVersion({
        actorUserId: null,
        database,
        jobId: fixture.publishJob.id,
        leaseOwner: publicationTestLeaseOwner,
        nowMs: 12,
        versionId: publicationTestVersionId,
      });
      const sourceId = (
        database
          .prepare("SELECT source_id FROM book_versions WHERE id = ?")
          .get(publicationTestVersionId) as { source_id: string }
      ).source_id;
      new SourceRepository(database).registerOriginal({
        bookId: fixture.book.id,
        id: "file_library_details_test_0001",
        mediaType: "application/zip",
        nowMs: 13,
        originalName: "Book source.zip",
        sha256: "e".repeat(64),
        sizeBytes: 1024,
        sourceId,
        storageRelativePath: "ignored/source.zip",
      });

      const details = new LibraryService(database).resolveDetails({
        administrator: anonymous,
        bookKey: String(fixture.book.id),
      });

      expect(details).toMatchObject({
        authors: ["A. Author"],
        bookKey: "canonical-book",
        description: "A stable description.",
        language: "en",
        startUrl: "/read/canonical-book/1",
        subtitle: "A subtitle",
        tocEntryCount: 2,
        tocTruncated: true,
        visibility: "public",
      });
      expect(details.toc).toEqual([
        expect.objectContaining({
          href: "/read/canonical-book/1#blk_stale_publish_test_0001",
          title: "Opening",
        }),
      ]);
      expect(details.originals).toEqual([
        expect.objectContaining({
          href: "/books/canonical-book/originals/file_library_details_test_0001",
          label: "Book source.zip",
          sizeBytes: 1024,
        }),
      ]);
    }));

  it("hides private details from anonymous visitors but permits the administrator", () =>
    withMigratedTestDatabase(async ({ database }) => {
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
      const service = new LibraryService(database);
      expect(() =>
        service.resolveDetails({
          administrator: anonymous,
          bookKey: String(fixture.book.id),
        }),
      ).toThrow(expect.objectContaining({ code: "NOT_FOUND", status: 404 }));
      expect(
        service.resolveDetails({
          administrator,
          bookKey: String(fixture.book.id),
        }).visibility,
      ).toBe("private");
    }));

  it("isolates a known public current book with no projection as unavailable", () =>
    withMigratedTestDatabase(async ({ database }) => {
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
        .prepare("DELETE FROM book_version_presentations WHERE version_id = ?")
        .run(publicationTestVersionId);
      expect(() =>
        new LibraryService(database).resolveDetails({
          administrator: anonymous,
          bookKey: String(fixture.book.id),
        }),
      ).toThrow(
        expect.objectContaining({ code: "BOOK_UNAVAILABLE", status: 503 }),
      );
    }));
});
