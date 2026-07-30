import type Database from "better-sqlite3";

import type { BookVersionPresentation } from "@/modules/catalog/application/public";
import { CandidatePublicationRepository } from "@/modules/publishing/adapters/sqlite/candidate-publication";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { VersionRepository } from "@/modules/publishing/adapters/sqlite/versions";
import {
  m1PublishPolicy,
  publishCandidate,
} from "@/modules/publishing/application/public";
import type { SearchSpool } from "@/modules/publishing/core/publication/search-model";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

const hash = "a".repeat(64);
export const publicationTestSourceId = "src_stale_publish_test_0001";
export const publicationTestVersionId = "ver_candidate_publish_test_0001";
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

function spool(bookId: number, versionId: string): SearchSpool {
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
    id: "imp_candidate_publish_test_0001",
    nowMs: 2,
    uploadRelativePath: "tmp/import.zip",
    uploadSha256: hash,
    uploadSizeBytes: 1,
  });
  new SourceRepository(database).createSnapshot({
    analysisVersion: "test-v1",
    bookId: book.id,
    createdFromImportId: imported.id,
    id: publicationTestSourceId,
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
    sourceId: publicationTestSourceId,
    title: "Book",
    yamlRelativePath: "books/1/draft/configs/1/book.yaml",
    yamlSha256: hash,
  });

  const candidates = new DraftCandidateRepository(database);
  const candidate = candidates.createForCurrentRevision({
    bookId: book.id,
    configRevision: 1,
    nowMs: 5,
    sourceId: publicationTestSourceId,
  });
  database
    .prepare("UPDATE jobs SET version_id = ? WHERE id = ? AND state = 'queued'")
    .run(publicationTestVersionId, candidate.jobId);
  const jobs = new JobRepository(database);
  const claimed = jobs.claimNext({
    leaseOwner: publicationTestLeaseOwner,
    nowMs: 6,
  });
  if (claimed?.id !== candidate.jobId) {
    throw new Error("CANDIDATE_JOB_WAS_NOT_CLAIMED");
  }

  if (options.registerReady !== false) {
    withImmediateTransaction(database, () => {
      new VersionRepository(database).registerReadyWithSearch({
        bookId: book.id,
        compilerVersion: "compiler-v5",
        completeAtMs: 11,
        configRevision: 1,
        createdByJobId: candidate.jobId,
        expectedSearchBlockIds: [blockId],
        manifestSchemaVersion: 2,
        manifestSha256: hash,
        predecessorVersionId: null,
        presentation: presentationForTest(book.id),
        rendererVersion: "semantic-html-v5-katex-0.18.1",
        semanticDigest: hash,
        sourceId: publicationTestSourceId,
        spool: spool(book.id, publicationTestVersionId),
        versionId: publicationTestVersionId,
        versionRelativePath: `books/1/versions/${publicationTestVersionId}`,
      });
      const ready = database
        .prepare(
          `UPDATE draft_candidates
           SET state = 'ready', version_id = ?, semantic_digest = ?,
               blocking_diagnostic_count = 0, completed_at = 11
           WHERE id = ? AND state = 'building' AND version_id IS NULL`,
        )
        .run(publicationTestVersionId, hash, candidate.attemptId);
      if (ready.changes !== 1)
        throw new Error("CANDIDATE_READY_FIXTURE_FAILED");
      jobs.completeSuccess({
        jobId: candidate.jobId,
        leaseOwner: publicationTestLeaseOwner,
        nowMs: 11,
      });
    });
  }

  const candidateJob = jobs.get(candidate.jobId);
  if (!candidateJob) throw new Error("CANDIDATE_JOB_MISSING");
  return {
    book,
    candidate: candidates.require(candidate.attemptId),
    candidateJob,
    candidates,
    drafts,
    jobs,
  };
}

export function publishReadyCandidateForTest(input: {
  readonly actorUserId?: string | null;
  readonly bookId: number;
  readonly database: Database.Database;
  readonly expectedConfigRevision?: number;
  readonly expectedVersionId?: string;
  readonly nowMs: number;
}) {
  return publishCandidate({
    actorUserId: input.actorUserId ?? null,
    bookId: input.bookId,
    expectedConfigRevision: input.expectedConfigRevision ?? 1,
    expectedVersionId: input.expectedVersionId ?? publicationTestVersionId,
    nowMs: input.nowMs,
    policy: m1PublishPolicy,
    publication: new CandidatePublicationRepository(input.database),
  });
}
