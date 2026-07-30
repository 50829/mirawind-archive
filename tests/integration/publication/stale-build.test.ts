import { describe, expect, it } from "vitest";

import { VersionRepository } from "@/modules/publishing/adapters/sqlite/versions";

import { withMigratedTestDatabase } from "../../helpers/database.js";
import {
  publicationTestSourceId,
  publicationTestVersionId,
  publishReadyCandidateForTest,
  setupPublicationFixture,
} from "../../helpers/publication.js";

describe("guarded candidate publication compare-and-swap", () => {
  it("atomically promotes the ready candidate and records one audit event", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);

      await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });

      expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
        currentVersionId: publicationTestVersionId,
        visibility: "public",
      });
      expect(
        new VersionRepository(database).require(publicationTestVersionId),
      ).toMatchObject({
        publishedAtMs: 12,
        state: "published",
      });
      expect(fixture.jobs.get(fixture.candidateJob.id)).toMatchObject({
        finishedAtMs: 11,
        state: "succeeded",
        versionId: publicationTestVersionId,
      });
      expect(
        database
          .prepare(
            "SELECT action, version_id FROM audit_events WHERE job_id = ?",
          )
          .all(fixture.candidateJob.id),
      ).toEqual([
        {
          action: "book.published",
          version_id: publicationTestVersionId,
        },
      ]);
    }));

  it("returns the original result when the same candidate is promoted again", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      const first = await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });
      const repeated = await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 13,
      });

      expect(repeated).toEqual(first);
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM audit_events WHERE action = 'book.published'",
          )
          .get(),
      ).toEqual({ count: 1 });
    }));

  it("keeps the public pointer empty when the draft becomes stale", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      fixture.drafts.addConfigRevision({
        bookId: fixture.book.id,
        nowMs: 12,
        revision: 2,
        schemaVersion: 3,
        sourceId: publicationTestSourceId,
        title: "New draft",
        yamlRelativePath: "books/1/draft/configs/2/book.yaml",
        yamlSha256: "b".repeat(64),
      });

      await expect(
        publishReadyCandidateForTest({
          bookId: fixture.book.id,
          database,
          nowMs: 13,
        }),
      ).rejects.toMatchObject({ code: "PUBLICATION_STALE" });
      expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
        currentVersionId: null,
        draftConfigRevision: 2,
        visibility: "draft",
      });
      expect(
        new VersionRepository(database).require(publicationTestVersionId).state,
      ).toBe("ready");
      expect(fixture.jobs.get(fixture.candidateJob.id)?.state).toBe("succeeded");
    }));
});
