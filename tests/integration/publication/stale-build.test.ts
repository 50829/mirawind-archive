import { describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

import type { SearchSpool } from "@/compiler/search/build-spool";
import { DraftRepository } from "@/db/repositories/drafts";
import { ImportRepository } from "@/db/repositories/imports";
import { JobRepository } from "@/db/repositories/jobs";
import { SourceRepository } from "@/db/repositories/sources";
import { VersionRepository } from "@/db/repositories/versions";
import { publishReadyVersion } from "@/services/publication";
import type { BookVersionPresentation } from "@/db/repositories/book-presentation-record";

import { withMigratedTestDatabase } from "../../helpers/database.js";

const hash = "a".repeat(64);
const sourceId = "src_stale_publish_test_0001";
export const publicationTestVersionId = "ver_stale_publish_test_0001";
const blockId = "blk_stale_publish_test_0001";
export const publicationTestLeaseOwner = "worker:test";

export function presentationForTest(
  bookId: number,
  versionId = publicationTestVersionId,
): BookVersionPresentation {
  return Object.freeze({
    alias: null,
    bookId,
    configRevision: 1,
    coverResourceId: null,
    createdAtMs: 11,
    firstPageAlias: null,
    firstPageId: 1,
    metadataJson: "{}\n",
    projectionSchemaVersion: 1,
    projectionSha256: hash,
    title: "Book",
    tocEntryCount: 0,
    tocPreviewJson: "[]\n",
    versionId,
  });
}

function spool(
  bookId: number,
  versionId = publicationTestVersionId,
): SearchSpool {
  return {
    digest: hash,
    ftsRows: [
      {
        authors: "",
        blockId,
        body: "Body",
        bookId,
        heading: "Chapter",
        kind: "paragraph",
        ordinal: 0,
        pageId: 1,
        title: "Book",
        versionId,
      },
    ],
    schemaVersion: 1,
    shortRows: [
      {
        blockId: null,
        bookId,
        kind: "title",
        normalizedText: "Book",
        ordinal: 0,
        pageId: 1,
        versionId,
      },
    ],
  };
}

export function setupPublicationFixture(
  database: Database.Database,
  options: { readonly registerReady?: boolean } = {},
) {
  const drafts = new DraftRepository(database);
  const book = drafts.createBook({ nowMs: 1, title: "Book" });
  const imported = new ImportRepository(database).createUploaded({
    bookId: book.id,
    expiresAtMs: 10_000,
    id: "imp_stale_publish_test_0001",
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
    schemaVersion: 3,
    sourceId,
    title: "Book",
    yamlRelativePath: "books/1/draft/configs/1/book.yaml",
    yamlSha256: hash,
  });
  const jobs = new JobRepository(database);
  const previewJob = jobs.create({
    bookId: book.id,
    capturedConfigRevision: 1,
    capturedSourceId: sourceId,
    kind: "build_preview",
    nowMs: 5,
  });
  drafts.createPreview({
    bookId: book.id,
    configRevision: 1,
    jobId: previewJob.id,
    sourceId,
  });
  const claimedPreview = jobs.claimNext({
    leaseOwner: publicationTestLeaseOwner,
    nowMs: 6,
  });
  if (!claimedPreview) throw new Error("Preview job was not claimed");
  jobs.completeSuccess({
    jobId: previewJob.id,
    leaseOwner: publicationTestLeaseOwner,
    nowMs: 7,
  });
  drafts.completePreview({
    bookId: book.id,
    configRevision: 1,
    diagnosticsRelativePath: "books/1/draft/previews/1/diagnostics.json",
    nowMs: 8,
    previewRelativePath: "books/1/draft/previews/1",
  });
  const publishJob = jobs.create({
    bookId: book.id,
    capturedConfigRevision: 1,
    capturedSourceId: sourceId,
    kind: "build_publish",
    nowMs: 9,
  });
  const claimedPublish = jobs.claimNext({
    leaseOwner: publicationTestLeaseOwner,
    nowMs: 10,
  });
  if (!claimedPublish) throw new Error("Publish job was not claimed");
  if (options.registerReady !== false) {
    new VersionRepository(database).registerReadyWithSearch({
      bookId: book.id,
      compilerVersion: "compiler-v4",
      completeAtMs: 11,
      configRevision: 1,
      createdByJobId: publishJob.id,
      expectedSearchBlockIds: [blockId],
      manifestSchemaVersion: 2,
      manifestSha256: hash,
      predecessorVersionId: null,
      presentation: presentationForTest(book.id),
      rendererVersion: "semantic-html-v4-katex-0.18.1",
      sourceId,
      spool: spool(book.id),
      versionId: publicationTestVersionId,
      versionRelativePath: `books/1/versions/${publicationTestVersionId}`,
    });
  }
  return { book, drafts, jobs, publishJob };
}

describe("guarded publication compare-and-swap", () => {
  it("atomically publishes a ready version, visibility, audit and job result", () =>
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
      expect(fixture.jobs.get(fixture.publishJob.id)).toMatchObject({
        finishedAtMs: 12,
        state: "succeeded",
        versionId: publicationTestVersionId,
      });
      expect(
        database
          .prepare(
            "SELECT action, version_id FROM audit_events WHERE job_id = ?",
          )
          .get(fixture.publishJob.id),
      ).toEqual({
        action: "book.published",
        version_id: publicationTestVersionId,
      });
    }));

  it("keeps the old pointer and ready version when the draft becomes stale", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      fixture.drafts.addConfigRevision({
        bookId: fixture.book.id,
        nowMs: 12,
        revision: 2,
        schemaVersion: 3,
        sourceId,
        title: "New draft",
        yamlRelativePath: "books/1/draft/configs/2/book.yaml",
        yamlSha256: "b".repeat(64),
      });

      await expect(
        publishReadyVersion({
          actorUserId: null,
          database,
          jobId: fixture.publishJob.id,
          leaseOwner: publicationTestLeaseOwner,
          nowMs: 13,
          versionId: publicationTestVersionId,
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
      expect(fixture.jobs.get(fixture.publishJob.id)?.state).toBe("running");
    }));

  it("allows only one of two builds captured from the same current pointer to cut over", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      const competingVersionId = "ver_stale_publish_competing_0001";
      const competingJob = fixture.jobs.create({
        bookId: fixture.book.id,
        capturedConfigRevision: 1,
        capturedSourceId: sourceId,
        kind: "build_publish",
        nowMs: 12,
      });
      new VersionRepository(database).registerReadyWithSearch({
        bookId: fixture.book.id,
        compilerVersion: "compiler-v4",
        completeAtMs: 13,
        configRevision: 1,
        createdByJobId: competingJob.id,
        expectedSearchBlockIds: [blockId],
        manifestSchemaVersion: 2,
        manifestSha256: "b".repeat(64),
        predecessorVersionId: null,
        presentation: presentationForTest(fixture.book.id, competingVersionId),
        rendererVersion: "semantic-html-v4-katex-0.18.1",
        sourceId,
        spool: spool(fixture.book.id, competingVersionId),
        versionId: competingVersionId,
        versionRelativePath: `books/1/versions/${competingVersionId}`,
      });
      await publishReadyVersion({
        actorUserId: null,
        database,
        jobId: fixture.publishJob.id,
        leaseOwner: publicationTestLeaseOwner,
        nowMs: 14,
        versionId: publicationTestVersionId,
      });
      const claimed = fixture.jobs.claimNext({
        leaseOwner: publicationTestLeaseOwner,
        nowMs: 15,
      });
      expect(claimed?.id).toBe(competingJob.id);

      await expect(
        publishReadyVersion({
          actorUserId: null,
          database,
          jobId: competingJob.id,
          leaseOwner: publicationTestLeaseOwner,
          nowMs: 16,
          versionId: competingVersionId,
        }),
      ).rejects.toMatchObject({ code: "PUBLICATION_STALE" });
      expect(fixture.drafts.requireBook(fixture.book.id).currentVersionId).toBe(
        publicationTestVersionId,
      );
      expect(
        new VersionRepository(database).require(competingVersionId).state,
      ).toBe("ready");
    }));
});
