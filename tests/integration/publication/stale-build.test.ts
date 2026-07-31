import { describe, expect, it } from "vitest";

import { createStrongEtag } from "@/http/cache/policies";
import { VersionRepository } from "@/modules/publishing/adapters/sqlite/versions";
import {
  CandidatePublicationRepository,
  type CandidatePromotionCrashPoint,
} from "@/modules/publishing/adapters/sqlite/candidate-publication";
import {
  m1PublishPolicy,
  publishCandidate,
} from "@/modules/publishing/application/public";

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
        access: "private",
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });

      expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
        currentVersionId: publicationTestVersionId,
        access: "private",
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

  it("queues the next candidate after publication without changing the public version", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });

      const next = fixture.candidates.createForCurrentRevision({
        bookId: fixture.book.id,
        configRevision: 1,
        nowMs: 13,
        sourceId: publicationTestSourceId,
      });

      expect(next).toMatchObject({ state: "building", versionId: null });
      expect(
        fixture.candidates.require(fixture.candidate.attemptId),
      ).toMatchObject({
        blockingDiagnosticCount: null,
        semanticDigest: null,
        state: "discarded",
        versionId: null,
      });
      expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
        currentCandidateId: next.attemptId,
        currentVersionId: publicationTestVersionId,
        access: "public",
      });
      expect(
        new VersionRepository(database).require(publicationTestVersionId),
      ).toMatchObject({ state: "published" });
    }));

  it("keeps the public pointer empty when the draft becomes stale", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      fixture.drafts.addConfigRevision({
        bookId: fixture.book.id,
        nowMs: 12,
        revision: 2,
        schemaVersion: 4,
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
        access: "private",
      });
      expect(
        new VersionRepository(database).require(publicationTestVersionId).state,
      ).toBe("ready");
      expect(fixture.jobs.get(fixture.candidateJob.id)?.state).toBe(
        "succeeded",
      );
    }));

  it.each(["after_version_before_book", "after_book_before_audit"] as const)(
    "rolls back publication interrupted at %s",
    async (point) => {
      await withMigratedTestDatabase(async ({ database }) => {
        const fixture = setupPublicationFixture(database);
        await expect(
          publishCandidate({
            actorUserId: null,
            bookId: fixture.book.id,
            expectedConfigEtag: createStrongEtag("a".repeat(64)),
            nowMs: 12,
            policy: m1PublishPolicy,
            publication: new CandidatePublicationRepository(
              database,
              (crashPoint: CandidatePromotionCrashPoint) => {
                if (crashPoint === point) throw new Error(`CRASH_${point}`);
              },
            ),
          }),
        ).rejects.toThrow(`CRASH_${point}`);
        expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
          currentVersionId: null,
          access: "private",
        });
        expect(
          new VersionRepository(database).require(publicationTestVersionId)
            .state,
        ).toBe("ready");
        expect(
          database
            .prepare(
              "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'book.published'",
            )
            .get(),
        ).toEqual({ count: 0 });
      });
    },
  );

  it("returns the committed publication after the first response is lost", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      await expect(
        publishCandidate({
          actorUserId: null,
          bookId: fixture.book.id,
          expectedConfigEtag: createStrongEtag("a".repeat(64)),
          nowMs: 12,
          policy: m1PublishPolicy,
          publication: new CandidatePublicationRepository(database, (point) => {
            if (point === "after_commit") throw new Error("RESPONSE_LOST");
          }),
        }),
      ).rejects.toThrow("RESPONSE_LOST");

      const repeated = await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 13,
      });
      expect(repeated).toMatchObject({
        publishedAtMs: 12,
        versionId: publicationTestVersionId,
      });
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'book.published'",
          )
          .get(),
      ).toEqual({ count: 1 });
    }));
});
