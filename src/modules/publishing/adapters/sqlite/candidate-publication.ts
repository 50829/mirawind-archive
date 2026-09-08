import type Database from "better-sqlite3";
import { SafeApplicationError } from "@/domain/errors";
import type {
  CandidatePublicationCapture,
  CandidatePublicationPort,
  PublishedCandidate,
} from "../../application/commands/publish-candidate";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { requireDraftTimestamp } from "../filesystem/draft-document";
import { DraftSaveRepository } from "./draft-saves";

interface PublicationRow {
  book_id: number;
  candidate_id: string;
  candidate_state: string;
  candidate_job_id: string;
  source_updated_at: number;
  import_id: string;
  draft_import_id: string | null;
  version_id: string;
  version_state: string;
  current_version_id: string | null;
  predecessor_version_id: string | null;
  published_at: number | null;
  blocking_diagnostic_count: number;
  semantic_digest: string;
  candidate_semantic_digest: string;
  alias: string | null;
}
export type CandidatePromotionCrashPoint =
  "after_version_before_book" | "after_book_before_audit" | "after_commit";
export type CandidatePromotionCrashPointInjector = (
  point: CandidatePromotionCrashPoint,
) => void;
function stale(): never {
  throw new SafeApplicationError(
    "PUBLICATION_STALE",
    "The ready preview no longer matches the draft.",
    409,
  );
}
export class CandidatePublicationRepository implements CandidatePublicationPort {
  constructor(
    private readonly database: Database.Database,
    private readonly layout: StorageLayout,
    private readonly crashPoint?: CandidatePromotionCrashPointInjector,
  ) {}
  private require(input: {
    bookId: number;
    candidateId: string;
    expectedUpdatedAt: number;
  }): PublicationRow {
    requireDraftTimestamp(this.layout, input.bookId, input.expectedUpdatedAt);
    if (new DraftSaveRepository(this.database).pending(input.bookId)) stale();
    const row = this.database
      .prepare(
        "SELECT books.id AS book_id,books.current_version_id,books.draft_import_id,candidate.id AS candidate_id,candidate.state AS candidate_state,candidate.job_id AS candidate_job_id,candidate.source_updated_at,candidate.import_id,candidate.semantic_digest AS candidate_semantic_digest,version.id AS version_id,version.state AS version_state,version.predecessor_version_id,version.published_at,version.blocking_diagnostic_count,version.semantic_digest,presentation.alias FROM books JOIN draft_candidates candidate ON candidate.id=books.current_candidate_id AND candidate.book_id=books.id JOIN book_versions version ON version.id=candidate.version_id AND version.book_id=books.id AND version.source_updated_at=candidate.source_updated_at AND version.import_id=candidate.import_id JOIN book_version_presentations presentation ON presentation.version_id=version.id WHERE books.id=? AND books.deletion_requested_at IS NULL",
      )
      .get(input.bookId) as PublicationRow | undefined;
    if (
      !row ||
      row.candidate_id !== input.candidateId ||
      row.source_updated_at !== input.expectedUpdatedAt ||
      row.candidate_state !== "ready" ||
      row.draft_import_id !== row.import_id ||
      row.semantic_digest !== row.candidate_semantic_digest ||
      row.blocking_diagnostic_count !== 0 ||
      !["ready", "published"].includes(row.version_state) ||
      (row.version_state === "ready" &&
        row.predecessor_version_id !== row.current_version_id) ||
      (row.version_state === "published" &&
        row.current_version_id !== row.version_id)
    )
      stale();
    return row;
  }
  capture(input: {
    readonly bookId: number;
    readonly expectedUpdatedAt: number;
    readonly candidateId: string;
  }): CandidatePublicationCapture {
    const row = this.require(input);
    return {
      bookId: row.book_id,
      sourceUpdatedAt: row.source_updated_at,
      importId: row.import_id,
      versionId: row.version_id,
      candidateId: row.candidate_id,
    };
  }
  promote(input: {
    readonly actorUserId: string | null;
    readonly bookId: number;
    readonly expectedUpdatedAt: number;
    readonly expectedVersionId: string;
    readonly candidateId: string;
    readonly nowMs: number;
  }): PublishedCandidate {
    const published = withImmediateTransaction(this.database, () => {
      const row = this.require(input);
      if (row.version_id !== input.expectedVersionId) stale();
      if (row.version_state === "published") {
        if (row.published_at === null)
          throw new Error("PUBLICATION_TIMESTAMP_MISSING");
        return {
          publishedAtMs: row.published_at,
          state: "published" as const,
          versionId: row.version_id,
        };
      }
      if (row.current_version_id !== null) {
        const changed = this.database
          .prepare(
            "UPDATE book_versions SET state='superseded' WHERE id=? AND book_id=? AND state='published'",
          )
          .run(row.current_version_id, row.book_id);
        if (changed.changes !== 1)
          throw new Error("PUBLICATION_OLD_STATE_INVALID");
      }
      const promoted = this.database
        .prepare(
          "UPDATE book_versions SET state='published',published_at=?,verified_at=? WHERE id=? AND book_id=? AND state='ready'",
        )
        .run(input.nowMs, input.nowMs, row.version_id, row.book_id);
      if (promoted.changes !== 1)
        throw new Error("PUBLICATION_READY_STATE_INVALID");
      this.crashPoint?.("after_version_before_book");
      const book = this.database
        .prepare(
          "UPDATE books SET current_version_id=?,alias=?,unavailable_reason=NULL,updated_at=? WHERE id=? AND current_candidate_id=? AND current_version_id IS ? AND deletion_requested_at IS NULL",
        )
        .run(
          row.version_id,
          row.alias,
          input.nowMs,
          row.book_id,
          row.candidate_id,
          row.current_version_id,
        );
      if (book.changes !== 1) throw new Error("PUBLICATION_BOOK_CAS_FAILED");
      this.crashPoint?.("after_book_before_audit");
      this.database
        .prepare(
          "INSERT INTO audit_events (actor_user_id,action,book_id,version_id,job_id,safe_metadata_json,created_at) VALUES (?,'book.published',?,?,?,?,?)",
        )
        .run(
          input.actorUserId,
          row.book_id,
          row.version_id,
          row.candidate_job_id,
          JSON.stringify({ source_updated_at: row.source_updated_at }),
          input.nowMs,
        );
      return {
        publishedAtMs: input.nowMs,
        state: "published" as const,
        versionId: row.version_id,
      };
    });
    this.crashPoint?.("after_commit");
    return published;
  }
}
