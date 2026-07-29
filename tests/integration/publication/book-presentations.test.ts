import { describe, expect, it } from "vitest";

import { BookPresentationRepository } from "@/modules/catalog/adapters/sqlite/book-presentations";
import { publishReadyVersion } from "@/modules/publishing/adapters/sqlite/publication";
import { serializeJobStatus } from "@/modules/publishing/adapters/sqlite/job-status";

import { withMigratedTestDatabase } from "../../helpers/database.js";
import {
  publicationTestLeaseOwner,
  publicationTestVersionId,
  setupPublicationFixture,
} from "./stale-build.test.js";

describe("current-version presentation publication", () => {
  it("keeps public metadata frozen while draft caches change", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      const presentations = new BookPresentationRepository(database);

      expect(presentations.require(publicationTestVersionId)).toMatchObject({
        title: "Book",
        versionId: publicationTestVersionId,
      });
      database
        .prepare(
          "UPDATE books SET title_cache = 'Unpublished title' WHERE id = ?",
        )
        .run(fixture.book.id);

      await publishReadyVersion({
        actorUserId: null,
        database,
        jobId: fixture.publishJob.id,
        leaseOwner: publicationTestLeaseOwner,
        nowMs: 12,
        versionId: publicationTestVersionId,
      });

      expect(
        presentations.requireCurrentForBook(fixture.book.id),
      ).toMatchObject({
        title: "Book",
        versionId: publicationTestVersionId,
      });
      expect(fixture.drafts.requireBook(fixture.book.id).title).toBe(
        "Unpublished title",
      );
      const completedJob = fixture.jobs.get(fixture.publishJob.id);
      if (!completedJob) throw new Error("PUBLISH_JOB_MISSING");
      expect(serializeJobStatus(completedJob, database).publication).toEqual({
        book_id: fixture.book.id,
        book_key: String(fixture.book.id),
        details_url: `/books/${fixture.book.id}`,
        library_url: "/library",
        start_url: `/read/${fixture.book.id}/1`,
        version_id: publicationTestVersionId,
      });
    }));

  it("refuses a current-pointer switch when the ready projection is absent", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      const runningJob = fixture.jobs.get(fixture.publishJob.id);
      if (!runningJob) throw new Error("PUBLISH_JOB_MISSING");
      expect(serializeJobStatus(runningJob, database).publication).toBeNull();
      database
        .prepare("DELETE FROM book_version_presentations WHERE version_id = ?")
        .run(publicationTestVersionId);

      await expect(
        publishReadyVersion({
          actorUserId: null,
          database,
          jobId: fixture.publishJob.id,
          leaseOwner: publicationTestLeaseOwner,
          nowMs: 12,
          versionId: publicationTestVersionId,
        }),
      ).rejects.toThrow("PUBLICATION_PRESENTATION_MISSING");
      expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
        currentVersionId: null,
        visibility: "draft",
      });
    }));
});
