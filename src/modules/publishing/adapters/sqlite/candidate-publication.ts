import type Database from "better-sqlite3";

import { SafeApplicationError } from "@/domain/errors";
import type {
  CandidatePublicationCapture,
  CandidatePublicationPort,
  PublishedCandidate,
} from "@/modules/publishing/application/commands/publish-candidate";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

interface PublicationRow {
  alias: string | null;
  blocking_diagnostic_count: number;
  book_id: number;
  candidate_job_id: string;
  candidate_semantic_digest: string;
  candidate_source_id: string;
  candidate_state: string;
  candidate_version_id: string;
  config_revision: number;
  current_version_id: string | null;
  draft_config_revision: number;
  draft_source_id: string;
  predecessor_version_id: string | null;
  published_at: number | null;
  semantic_digest: string;
  source_id: string;
  version_id: string;
  version_state: string;
}

function stale(): never {
  throw new SafeApplicationError(
    "PUBLICATION_STALE",
    "The ready candidate no longer matches the current draft.",
    409,
  );
}

export class CandidatePublicationRepository
  implements CandidatePublicationPort
{
  constructor(private readonly database: Database.Database) {}

  private row(bookId: number, versionId: string): PublicationRow | null {
    return (this.database
      .prepare(
        `SELECT books.id AS book_id, books.draft_source_id,
                books.draft_config_revision, books.current_version_id,
                candidate.state AS candidate_state,
                candidate.source_id AS candidate_source_id,
                candidate.config_revision, candidate.job_id AS candidate_job_id,
                candidate.version_id AS candidate_version_id,
                candidate.semantic_digest AS candidate_semantic_digest,
                version.id AS version_id, version.state AS version_state,
                version.source_id, version.predecessor_version_id,
                version.semantic_digest, version.blocking_diagnostic_count,
                version.published_at, presentation.alias
         FROM books
         JOIN draft_candidates AS candidate
           ON candidate.id = books.current_candidate_id
          AND candidate.book_id = books.id
         JOIN book_versions AS version
           ON version.id = candidate.version_id
          AND version.book_id = books.id
         JOIN book_version_presentations AS presentation
           ON presentation.version_id = version.id
          AND presentation.book_id = books.id
         WHERE books.id = ? AND version.id = ?
           AND books.deletion_requested_at IS NULL`,
      )
      .get(bookId, versionId) ?? null) as PublicationRow | null;
  }

  private validate(
    row: PublicationRow | null,
    expectedConfigRevision: number,
    expectedVersionId: string,
  ): PublicationRow {
    if (
      !row ||
      row.candidate_state !== "ready" ||
      row.candidate_version_id !== expectedVersionId ||
      row.version_id !== expectedVersionId ||
      row.config_revision !== expectedConfigRevision ||
      row.draft_config_revision !== expectedConfigRevision ||
      row.candidate_source_id !== row.draft_source_id ||
      row.source_id !== row.draft_source_id ||
      row.candidate_semantic_digest !== row.semantic_digest ||
      row.blocking_diagnostic_count !== 0 ||
      !["ready", "published"].includes(row.version_state)
    ) {
      return stale();
    }
    if (
      row.version_state === "published" &&
      row.current_version_id !== expectedVersionId
    ) {
      return stale();
    }
    if (
      row.version_state === "ready" &&
      row.predecessor_version_id !== row.current_version_id
    ) {
      return stale();
    }
    return row;
  }

  capture(input: {
    readonly bookId: number;
    readonly expectedConfigRevision: number;
    readonly expectedVersionId: string;
  }): CandidatePublicationCapture {
    const row = this.validate(
      this.row(input.bookId, input.expectedVersionId),
      input.expectedConfigRevision,
      input.expectedVersionId,
    );
    return Object.freeze({
      bookId: row.book_id,
      configRevision: row.config_revision,
      sourceId: row.source_id,
      versionId: row.version_id,
    });
  }

  promote(input: {
    readonly actorUserId: string | null;
    readonly bookId: number;
    readonly expectedConfigRevision: number;
    readonly expectedVersionId: string;
    readonly nowMs: number;
  }): PublishedCandidate {
    return withImmediateTransaction(this.database, () => {
      const row = this.validate(
        this.row(input.bookId, input.expectedVersionId),
        input.expectedConfigRevision,
        input.expectedVersionId,
      );
      if (row.version_state === "published") {
        if (row.published_at === null) throw new Error("PUBLICATION_TIMESTAMP_MISSING");
        return Object.freeze({
          publishedAtMs: row.published_at,
          state: "published" as const,
          versionId: row.version_id,
        });
      }
      if (row.current_version_id !== null) {
        const previous = this.database
          .prepare(
            `UPDATE book_versions SET state = 'superseded'
             WHERE id = ? AND book_id = ? AND state = 'published'`,
          )
          .run(row.current_version_id, row.book_id);
        if (previous.changes !== 1) throw new Error("PUBLICATION_OLD_STATE_INVALID");
      }
      const promoted = this.database
        .prepare(
          `UPDATE book_versions
           SET state = 'published', published_at = ?, verified_at = ?
           WHERE id = ? AND book_id = ? AND state = 'ready'`,
        )
        .run(input.nowMs, input.nowMs, row.version_id, row.book_id);
      if (promoted.changes !== 1) throw new Error("PUBLICATION_READY_STATE_INVALID");
      const book = this.database
        .prepare(
          `UPDATE books
           SET current_version_id = ?, visibility = 'public', alias = ?,
               unavailable_reason = NULL, updated_at = ?
           WHERE id = ? AND current_candidate_id = (
             SELECT id FROM draft_candidates WHERE version_id = ?
           ) AND draft_source_id = ? AND draft_config_revision = ?
             AND current_version_id IS ? AND deletion_requested_at IS NULL`,
        )
        .run(
          row.version_id,
          row.alias,
          input.nowMs,
          row.book_id,
          row.version_id,
          row.source_id,
          row.config_revision,
          row.current_version_id,
        );
      if (book.changes !== 1) throw new Error("PUBLICATION_BOOK_CAS_FAILED");
      this.database
        .prepare(
          `INSERT INTO audit_events (
            actor_user_id, action, book_id, version_id, job_id,
            safe_metadata_json, created_at
          ) VALUES (?, 'book.published', ?, ?, ?, ?, ?)`,
        )
        .run(
          input.actorUserId,
          row.book_id,
          row.version_id,
          row.candidate_job_id,
          JSON.stringify({ config_revision: row.config_revision }),
          input.nowMs,
        );
      return Object.freeze({
        publishedAtMs: input.nowMs,
        state: "published" as const,
        versionId: row.version_id,
      });
    });
  }
}
