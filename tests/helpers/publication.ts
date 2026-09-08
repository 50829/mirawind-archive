import type Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { SqliteBookAccessRepository } from "@/modules/catalog/adapters/sqlite/book-access";
import { setBookAccess } from "@/modules/catalog/application/commands/set-book-access";
import type { BookVersionPresentation } from "@/modules/catalog/application/catalog-api";
import { BookPresentationRepository } from "@/modules/catalog/adapters/sqlite/book-presentations";
import { CandidatePublicationRepository } from "@/modules/publishing/adapters/sqlite/candidate-publication";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { VersionRepository } from "@/modules/publishing/adapters/sqlite/versions";
import {
  m1PublishPolicy,
  publishCandidate,
} from "@/modules/publishing/application/publishing-api";
import type { SearchSpool } from "@/modules/publishing/core/publication/search-model";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { smallBook } from "./ir-book";
import { serializeBookDocument } from "@/modules/publishing/core/content/book-document";
import { readDraftHeader } from "@/modules/publishing/adapters/filesystem/draft-document";

const hash = "a".repeat(64);
export const publicationTestUpdatedAt = 1000;
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
    sourceUpdatedAt: publicationTestUpdatedAt,
    coverResourceId: null,
    createdAtMs: 11,
    firstPageAlias: null,
    firstPageId: 1,
    metadataJson: "{}\n",
    projectionSchemaVersion: 3,
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
    originalName: "fixture.zip",
    uploadRelativePath: "tmp/import.zip",
    uploadSha256: hash,
    uploadSizeBytes: 1,
  });
  const layout = publicationLayoutForTest(database);
  const document = smallBook(book.id, publicationTestUpdatedAt);
  const draftPath = resolve(
    layout.bookDirectory,
    String(book.id),
    "draft/book.json",
  );
  mkdirSync(dirname(draftPath), { recursive: true, mode: 0o700 });
  writeFileSync(draftPath, serializeBookDocument(document), { mode: 0o600 });

  const candidates = new DraftCandidateRepository(database);
  const candidate = candidates.createForDocument({
    bookId: book.id,
    sourceUpdatedAt: publicationTestUpdatedAt,
    nowMs: 5,
    importId: imported.id,
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
        compilerVersion: "compiler-v7",
        completeAtMs: 11,
        sourceUpdatedAt: publicationTestUpdatedAt,
        createdByJobId: candidate.jobId,
        expectedSearchBlockIds: [blockId],
        manifestSchemaVersion: 4,
        manifestSha256: hash,
        predecessorVersionId: null,
        presentation: presentationForTest(book.id),
        presentationWriter: new BookPresentationRepository(database),
        rendererVersion: "semantic-html-v7-katex-0.18.1",
        semanticDigest: hash,
        importId: imported.id,
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
    document,
    draftPath,
    imported,
    layout,
    candidate: candidates.require(candidate.attemptId),
    candidateJob,
    candidates,
    drafts,
    jobs,
  };
}

export async function publishReadyCandidateForTest(input: {
  readonly access?: "private" | "public";
  readonly actorUserId?: string | null;
  readonly bookId: number;
  readonly database: Database.Database;
  readonly expectedUpdatedAt?: number;
  readonly candidateId?: string;
  readonly nowMs: number;
}) {
  const layout = publicationLayoutForTest(input.database);
  const expectedUpdatedAt =
    input.expectedUpdatedAt ??
    readDraftHeader(
      resolve(layout.bookDirectory, String(input.bookId), "draft/book.json"),
      input.bookId,
    ).updated_at;
  const candidate = new DraftCandidateRepository(input.database).findCurrent(
    input.bookId,
  );
  const candidateId = input.candidateId ?? candidate?.attemptId;
  if (!candidateId) throw new Error("CANDIDATE_MISSING");
  const published = await publishCandidate({
    actorUserId: input.actorUserId ?? null,
    bookId: input.bookId,
    expectedUpdatedAt,
    candidateId,
    nowMs: input.nowMs,
    policy: m1PublishPolicy,
    publication: new CandidatePublicationRepository(input.database, layout),
  });
  if ((input.access ?? "public") === "public") {
    setBookAccess({
      access: "public",
      actorUserId: input.actorUserId ?? null,
      bookId: input.bookId,
      books: new SqliteBookAccessRepository(input.database),
      nowMs: input.nowMs,
    });
  }
  return published;
}

export function publicationLayoutForTest(
  database: Database.Database,
): StorageLayout {
  const root = dirname(dirname(database.name));
  return {
    root,
    databaseDirectory: resolve(root, "db"),
    bookDirectory: resolve(root, "books"),
    temporaryDirectory: resolve(root, "tmp"),
    uploadDirectory: resolve(root, "tmp/uploads"),
  };
}
