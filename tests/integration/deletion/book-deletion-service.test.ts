import { describe, expect, it } from "vitest";

import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { SafeApplicationError } from "@/domain/errors";
import { acceptBookDeletion } from "@/modules/catalog/adapters/sqlite/book-deletion";
import { createBookDeletionToken } from "@/modules/catalog/core/book-deletion-token";
import { LibraryService } from "@/modules/catalog/adapters/sqlite/library";

import { withMigratedTestDatabase } from "../../helpers/database";

function token(book: ReturnType<DraftRepository["createBook"]>): string {
  return createBookDeletionToken({
    alias: book.alias,
    bookId: book.id,
    currentCandidateId: book.currentCandidateId,
    currentVersionId: book.currentVersionId,
    draftConfigRevision: book.draftConfigRevision,
    draftSourceId: book.draftSourceId,
    title: book.title,
    updatedAtMs: book.updatedAtMs,
  });
}

describe("permanent book deletion acceptance", () => {
  it("atomically hides the book, releases its alias and creates one content-free tombstone task", async () => {
    await withMigratedTestDatabase(({ database }) => {
      const drafts = new DraftRepository(database);
      const book = drafts.createBook({ nowMs: 1_000, title: "水与风" });
      database
        .prepare("UPDATE books SET alias = 'water-wind' WHERE id = ?")
        .run(book.id);
      const current = drafts.requireBook(book.id);
      const competing = new JobRepository(database).create({
        bookId: book.id,
        kind: "reclaim",
        nowMs: 1_100,
      });
      const result = acceptBookDeletion({
        actorUserId: "admin",
        bookId: book.id,
        confirmationTitle: "水与风",
        database,
        idempotencyKey: "delete-book-request-0001",
        mutationToken: token(current),
        nowMs: 2_000,
      });

      expect(result).toMatchObject({
        state: "pending",
        taskUrl: "/manage/tasks",
      });
      expect(
        new LibraryService(database).administratorLibrary({
          afterBookId: null,
          limit: 100,
        }).entries,
      ).toEqual([]);
      expect(
        database
          .prepare(
            "SELECT alias, deletion_requested_at FROM books WHERE id = ?",
          )
          .get(book.id),
      ).toEqual({ alias: null, deletion_requested_at: 2_000 });
      expect(new JobRepository(database).get(competing.id)?.state).toBe(
        "canceled",
      );
      expect(new JobRepository(database).get(result.jobId)).toMatchObject({
        bookId: book.id,
        kind: "reclaim",
        state: "queued",
      });
      expect(database.prepare("SELECT * FROM book_deletions").all()).toEqual([
        expect.objectContaining({
          book_id: book.id,
          cleanup_job_id: result.jobId,
          id: result.deletionId,
          state: "pending",
        }),
      ]);
      const columns = Object.keys(
        database.prepare("SELECT * FROM book_deletions").get() as object,
      );
      expect(columns).not.toEqual(
        expect.arrayContaining(["title", "alias", "path", "filename"]),
      );
    });
  });

  it("replays the same accepted request but rejects mismatched or stale confirmation", async () => {
    await withMigratedTestDatabase(({ database }) => {
      const drafts = new DraftRepository(database);
      const book = drafts.createBook({ nowMs: 1_000, title: "Cafe\u0301" });
      const mutationToken = token(book);
      const first = acceptBookDeletion({
        actorUserId: "admin",
        bookId: book.id,
        confirmationTitle: "Café",
        database,
        idempotencyKey: "delete-book-request-0002",
        mutationToken,
        nowMs: 2_000,
      });
      expect(
        acceptBookDeletion({
          actorUserId: "admin",
          bookId: book.id,
          confirmationTitle: "Cafe\u0301",
          database,
          idempotencyKey: "delete-book-request-0002",
          mutationToken,
          nowMs: 3_000,
        }),
      ).toEqual(first);
      expect(() =>
        acceptBookDeletion({
          actorUserId: "admin",
          bookId: book.id,
          confirmationTitle: "Different",
          database,
          idempotencyKey: "delete-book-request-0002",
          mutationToken,
          nowMs: 3_000,
        }),
      ).toThrow(
        expect.objectContaining<Partial<SafeApplicationError>>({
          code: "IDEMPOTENCY_KEY_CONFLICT",
          status: 409,
        }),
      );
      expect(() =>
        acceptBookDeletion({
          actorUserId: "admin",
          bookId: book.id,
          confirmationTitle: "Café",
          database,
          idempotencyKey: "delete-book-request-0003",
          mutationToken,
          nowMs: 3_000,
        }),
      ).toThrow(
        expect.objectContaining<Partial<SafeApplicationError>>({
          code: "NOT_FOUND",
          status: 404,
        }),
      );
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM book_deletions").get(),
      ).toEqual({ count: 1 });
    });
  });

  it("creates no state when the title or mutation token is stale", async () => {
    await withMigratedTestDatabase(({ database }) => {
      const drafts = new DraftRepository(database);
      const book = drafts.createBook({ nowMs: 1_000, title: "Original" });
      for (const input of [
        { confirmationTitle: "original", mutationToken: token(book) },
        { confirmationTitle: "Original", mutationToken: `"${"x".repeat(43)}"` },
      ]) {
        expect(() =>
          acceptBookDeletion({
            actorUserId: "admin",
            bookId: book.id,
            database,
            idempotencyKey: `delete-stale-${input.mutationToken}`,
            nowMs: 2_000,
            ...input,
          }),
        ).toThrow(
          expect.objectContaining<Partial<SafeApplicationError>>({
            code: "DELETION_CONFIRMATION_STALE",
            status: 412,
          }),
        );
      }
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM book_deletions").get(),
      ).toEqual({ count: 0 });
      expect(drafts.requireBook(book.id).title).toBe("Original");
    });
  });

  it("cancels indirectly related queued work and requests termination of running work", async () => {
    await withMigratedTestDatabase(({ database }) => {
      const drafts = new DraftRepository(database);
      const book = drafts.createBook({ nowMs: 1_000, title: "Busy book" });
      const importId = "imp_busycancellation";
      database
        .prepare(
          `INSERT INTO imports (
            id, state, upload_rel_path, upload_size_bytes, upload_sha256,
            selected_candidate_id, book_id, safe_error_code,
            created_at, updated_at, expires_at
          ) VALUES (?, 'uploaded', ?, 3, ?, NULL, ?, NULL, 1000, 1000, 9000)`,
        )
        .run(
          importId,
          `tmp/uploads/${importId}/original.zip`,
          "a".repeat(64),
          book.id,
        );
      const jobs = new JobRepository(database);
      const indirect = jobs.create({
        importId,
        kind: "analyze_import",
        nowMs: 1_100,
      });
      expect(jobs.claimNext({ leaseOwner: "worker", nowMs: 1_200 })?.id).toBe(
        indirect.id,
      );

      const accepted = acceptBookDeletion({
        actorUserId: "admin",
        bookId: book.id,
        confirmationTitle: book.title,
        database,
        idempotencyKey: "delete-busy-book-0001",
        mutationToken: token(book),
        nowMs: 2_000,
      });
      expect(jobs.get(indirect.id)).toMatchObject({
        cancellationRequestedAtMs: 2_000,
        state: "running",
      });
      expect(jobs.get(accepted.jobId)).toMatchObject({
        state: "queued",
      });
      expect(
        jobs.claimNext({ leaseOwner: "another-worker", nowMs: 2_100 }),
      ).toBeNull();
    });
  });
});
