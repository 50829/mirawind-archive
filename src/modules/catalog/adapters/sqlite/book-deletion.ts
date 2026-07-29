import { createHash, timingSafeEqual } from "node:crypto";

import type Database from "better-sqlite3";

import { BookDeletionRepository } from "@/modules/catalog/adapters/sqlite/book-deletions";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import { SafeApplicationError } from "@/domain/errors";
import { createOpaqueId } from "@/domain/ids";
import {
  createBookDeletionToken,
  normalizeMutationToken,
} from "@/modules/catalog/core/book-deletion-token";

interface DeletableBookRow {
  alias: string | null;
  current_version_id: string | null;
  deletion_requested_at: number | null;
  draft_config_revision: number | null;
  draft_source_id: string | null;
  id: number;
  ready_preview_revision: number | null;
  title_cache: string;
  updated_at: number;
}

export interface AcceptedBookDeletion {
  readonly deletionId: string;
  readonly jobId: string;
  readonly state: "completed" | "failed" | "pending" | "purging";
  readonly taskUrl: "/manage/tasks";
}

function sha256(...parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(`${Buffer.byteLength(part, "utf8")}:`, "utf8");
    hash.update(part, "utf8");
  }
  return hash.digest("hex");
}

function requireIdempotencyKey(value: string): string {
  if (
    [...value].length < 16 ||
    [...value].length > 200 ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  ) {
    throw new SafeApplicationError(
      "IDEMPOTENCY_KEY_INVALID",
      "A valid Idempotency-Key header is required.",
      400,
    );
  }
  return value;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function response(input: {
  readonly cleanupJobId: string;
  readonly id: string;
  readonly state: AcceptedBookDeletion["state"];
}): AcceptedBookDeletion {
  return Object.freeze({
    deletionId: input.id,
    jobId: input.cleanupJobId,
    state: input.state,
    taskUrl: "/manage/tasks",
  });
}

function cancelRelatedJobs(
  database: Database.Database,
  bookId: number,
  cleanupJobId: string,
  nowMs: number,
): void {
  const relationship = `
    id != @cleanupJobId AND (
      book_id = @bookId
      OR import_id IN (
        SELECT id FROM imports
        WHERE book_id = @bookId
           OR id IN (
             SELECT created_from_import_id
             FROM source_snapshots WHERE book_id = @bookId
           )
      )
      OR captured_source_id IN (
        SELECT id FROM source_snapshots WHERE book_id = @bookId
      )
      OR version_id IN (
        SELECT id FROM book_versions WHERE book_id = @bookId
      )
      OR captured_current_version_id IN (
        SELECT id FROM book_versions WHERE book_id = @bookId
      )
    )`;
  database
    .prepare(
      `UPDATE jobs
       SET state = 'canceled', cancellation_requested_at = @nowMs,
           finished_at = @nowMs, error_class = 'canceled',
           error_code = 'JOB_CANCELED', phase = 'canceled',
           progress_json = '{}', error_detail_json = NULL
       WHERE state = 'queued' AND ${relationship}`,
    )
    .run({ bookId, cleanupJobId, nowMs });
  database
    .prepare(
      `UPDATE jobs
       SET cancellation_requested_at = COALESCE(cancellation_requested_at, @nowMs)
       WHERE state = 'running' AND ${relationship}`,
    )
    .run({ bookId, cleanupJobId, nowMs });
}

export function acceptBookDeletion(input: {
  readonly actorUserId: string;
  readonly bookId: number;
  readonly confirmationTitle: string;
  readonly database: Database.Database;
  readonly idempotencyKey: string;
  readonly mutationToken: string;
  readonly nowMs: number;
}): AcceptedBookDeletion {
  if (!Number.isSafeInteger(input.bookId) || input.bookId < 1) {
    throw new SafeApplicationError("NOT_FOUND", "The book was not found.", 404);
  }
  if (
    !input.actorUserId ||
    [...input.actorUserId].length > 200 ||
    typeof input.confirmationTitle !== "string" ||
    [...input.confirmationTitle].length > 500
  ) {
    throw new SafeApplicationError(
      "REQUEST_BODY_INVALID",
      "The deletion confirmation is invalid.",
      400,
    );
  }
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const mutationToken = normalizeMutationToken(input.mutationToken);
  if (!mutationToken) {
    throw new SafeApplicationError(
      "DELETION_CONFIRMATION_STALE",
      "The deletion confirmation is stale.",
      412,
    );
  }
  const normalizedTitle = input.confirmationTitle.normalize("NFC");
  const idempotencyKeyHash = sha256(idempotencyKey);
  const requestFingerprint = sha256(
    "book-delete-v1",
    String(input.bookId),
    mutationToken,
    sha256(normalizedTitle),
  );

  return withImmediateTransaction(input.database, () => {
    const deletions = new BookDeletionRepository(input.database);
    const replay = deletions.findByIdempotencyHash(idempotencyKeyHash);
    if (replay) {
      if (
        replay.bookId !== input.bookId ||
        replay.requestFingerprint !== requestFingerprint
      ) {
        throw new SafeApplicationError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "The idempotency key was already used for another operation.",
          409,
        );
      }
      return response(replay);
    }

    const book = input.database
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(input.bookId) as DeletableBookRow | undefined;
    if (!book || book.deletion_requested_at !== null) {
      throw new SafeApplicationError(
        "NOT_FOUND",
        "The book was not found.",
        404,
      );
    }
    const currentToken = createBookDeletionToken({
      alias: book.alias,
      bookId: book.id,
      currentVersionId: book.current_version_id,
      draftConfigRevision: book.draft_config_revision,
      draftSourceId: book.draft_source_id,
      readyPreviewRevision: book.ready_preview_revision,
      title: book.title_cache,
      updatedAtMs: book.updated_at,
    });
    if (
      !safeEqual(currentToken, mutationToken) ||
      book.title_cache.normalize("NFC") !== normalizedTitle
    ) {
      throw new SafeApplicationError(
        "DELETION_CONFIRMATION_STALE",
        "The deletion confirmation is stale.",
        412,
      );
    }

    const deletionId = createOpaqueId("deletion");
    const cleanupJobId = createOpaqueId("job");
    input.database
      .prepare(
        `INSERT INTO jobs (
          id, kind, state, import_id, book_id, version_id,
          captured_source_id, captured_config_revision,
          captured_current_version_id, retry_of_job_id, attempt,
          automatic_retry_count, lease_owner, lease_until, heartbeat_at,
          phase, progress_json, error_code, error_class, error_detail_json,
          cancellation_requested_at, created_at, started_at, finished_at
        ) VALUES (
          ?, 'reclaim', 'queued', NULL, ?, NULL, NULL, NULL, NULL, NULL, 1,
          0, NULL, NULL, NULL, 'deletion_pending', '{}', NULL, NULL, NULL,
          NULL, ?, NULL, NULL
        )`,
      )
      .run(cleanupJobId, input.bookId, input.nowMs);
    input.database
      .prepare(
        `INSERT INTO book_deletions (
          id, book_id, requested_by_user_id, cleanup_job_id,
          idempotency_key_hash, request_fingerprint, state, safe_error_code,
          requested_at, started_at, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, NULL, ?)`,
      )
      .run(
        deletionId,
        input.bookId,
        input.actorUserId,
        cleanupJobId,
        idempotencyKeyHash,
        requestFingerprint,
        input.nowMs,
        input.nowMs,
      );
    const barrier = input.database
      .prepare(
        `UPDATE books
         SET deletion_requested_at = ?, alias = NULL, updated_at = ?
         WHERE id = ? AND deletion_requested_at IS NULL
           AND updated_at = ?`,
      )
      .run(input.nowMs, input.nowMs, input.bookId, book.updated_at);
    if (barrier.changes !== 1) {
      throw new SafeApplicationError(
        "DELETION_CONFIRMATION_STALE",
        "The deletion confirmation is stale.",
        412,
      );
    }
    cancelRelatedJobs(input.database, input.bookId, cleanupJobId, input.nowMs);
    input.database
      .prepare(
        `INSERT INTO audit_events (
          actor_user_id, action, book_id, version_id, job_id,
          safe_metadata_json, created_at
        ) VALUES (?, 'book.deletion.requested', ?, NULL, ?, ?, ?)`,
      )
      .run(
        input.actorUserId,
        input.bookId,
        cleanupJobId,
        JSON.stringify({ deletion_id: deletionId }),
        input.nowMs,
      );
    return response({
      cleanupJobId,
      id: deletionId,
      state: "pending",
    });
  });
}
