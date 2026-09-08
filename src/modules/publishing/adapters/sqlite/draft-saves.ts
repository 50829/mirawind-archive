import type Database from "better-sqlite3";
import { SafeApplicationError } from "@/domain/errors";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import { JobRepository, type UserJobRecord } from "./jobs";
import { DraftCandidateRepository } from "./draft-candidate-repository";

export interface DraftSaveRecord {
  readonly job_id: string;
  readonly book_id: number;
  readonly expected_updated_at: number;
  readonly payload_json: string;
  readonly accepted_updated_at: number | null;
  readonly prepared_path: string | null;
  readonly document_sha256: string | null;
  readonly no_change: 0 | 1;
}
export class DraftSaveRepository {
  constructor(private readonly database: Database.Database) {}
  require(jobId: string): DraftSaveRecord {
    const row = this.database
      .prepare("SELECT * FROM save_draft_requests WHERE job_id = ?")
      .get(jobId) as DraftSaveRecord | undefined;
    if (!row) throw new Error("DRAFT_SAVE_REQUEST_MISSING");
    return row;
  }
  enqueue(input: {
    readonly bookId: number;
    readonly expectedUpdatedAt: number;
    readonly patch: unknown;
    readonly nowMs: number;
    readonly assertCurrent: () => void;
  }): UserJobRecord {
    const payload = JSON.stringify(input.patch);
    if (Buffer.byteLength(payload) > 4 * 1024 * 1024)
      throw new SafeApplicationError(
        "DRAFT_PATCH_TOO_LARGE",
        "The draft edit is too large.",
        413,
      );
    return withImmediateTransaction(this.database, () => {
      input.assertCurrent();
      const book = this.database
        .prepare(
          "SELECT draft_import_id FROM books WHERE id = ? AND deletion_requested_at IS NULL",
        )
        .get(input.bookId) as { draft_import_id: string | null } | undefined;
      if (!book?.draft_import_id)
        throw new SafeApplicationError(
          "NOT_FOUND",
          "The draft was not found.",
          404,
        );
      const job = new JobRepository(this.database).create({
        bookId: input.bookId,
        importId: book.draft_import_id,
        kind: "save_draft",
        capturedSourceUpdatedAt: input.expectedUpdatedAt,
        nowMs: input.nowMs,
      });
      this.database
        .prepare(
          "INSERT INTO save_draft_requests (job_id,book_id,expected_updated_at,payload_json) VALUES (?,?,?,?)",
        )
        .run(job.id, input.bookId, input.expectedUpdatedAt, payload);
      this.supersedeBuilds(input.bookId, input.nowMs);
      return job;
    });
  }
  private supersedeBuilds(bookId: number, nowMs: number): void {
    const queued = this.database
      .prepare(
        "SELECT id,candidate_id FROM jobs WHERE book_id = ? AND kind = 'build_candidate' AND state = 'queued'",
      )
      .all(bookId) as { id: string; candidate_id: string | null }[];
    const candidates = new DraftCandidateRepository(this.database);
    for (const old of queued) {
      this.database
        .prepare(
          "UPDATE jobs SET state='canceled',phase='canceled',error_class='canceled',error_code='CANDIDATE_SUPERSEDED',cancellation_requested_at=?,finished_at=? WHERE id=? AND state='queued'",
        )
        .run(nowMs, nowMs, old.id);
      if (old.candidate_id)
        candidates.terminalize({
          candidateId: old.candidate_id,
          jobId: old.id,
          nowMs,
          safeErrorCode: "CANDIDATE_SUPERSEDED",
          state: "canceled",
        });
    }
    this.database
      .prepare(
        "UPDATE jobs SET cancellation_requested_at = COALESCE(cancellation_requested_at,?),error_code='CANDIDATE_SUPERSEDED' WHERE book_id = ? AND kind = 'build_candidate' AND state = 'running'",
      )
      .run(nowMs, bookId);
  }
  prepared(input: {
    readonly jobId: string;
    readonly timestamp: number;
    readonly path: string;
    readonly sha256: string;
    readonly noChange: boolean;
  }): void {
    this.database
      .prepare(
        "UPDATE save_draft_requests SET accepted_updated_at=?,prepared_path=?,document_sha256=?,no_change=? WHERE job_id=?",
      )
      .run(
        input.timestamp,
        input.path,
        input.sha256,
        input.noChange ? 1 : 0,
        input.jobId,
      );
  }
  copyForRetry(previousId: string, nextId: string, nowMs: number): void {
    const result = this.database
      .prepare(
        "INSERT OR IGNORE INTO save_draft_requests (job_id,book_id,expected_updated_at,payload_json,accepted_updated_at,prepared_path,document_sha256,no_change) SELECT ?,book_id,expected_updated_at,payload_json,accepted_updated_at,prepared_path,document_sha256,no_change FROM save_draft_requests WHERE job_id=?",
      )
      .run(nextId, previousId);
    const copied = this.require(nextId);
    if (result.changes === 1) this.supersedeBuilds(copied.book_id, nowMs);
  }
  pending(bookId: number): boolean {
    return Boolean(
      this.database
        .prepare(
          "SELECT 1 FROM jobs WHERE book_id=? AND kind='save_draft' AND state IN ('queued','running') LIMIT 1",
        )
        .get(bookId),
    );
  }
  acceptedDigest(bookId: number, updatedAt: number): string | null {
    return (
      (
        this.database
          .prepare(
            "SELECT request.document_sha256 FROM save_draft_requests request JOIN jobs ON jobs.id=request.job_id WHERE request.book_id=? AND request.accepted_updated_at=? AND jobs.state='succeeded' ORDER BY jobs.created_at DESC LIMIT 1",
          )
          .get(bookId, updatedAt) as { document_sha256: string } | undefined
      )?.document_sha256 ?? null
    );
  }
  resourceProof(
    bookId: number,
    ids: readonly string[],
  ): readonly { id: string; size: number; sha256: string }[] {
    const rows = this.database
      .prepare(
        "SELECT id,size_bytes AS size,sha256 FROM book_resources WHERE book_id=? AND id IN (SELECT value FROM json_each(?))",
      )
      .all(bookId, JSON.stringify(ids)) as {
      id: string;
      size: number;
      sha256: string;
    }[];
    if (rows.length !== new Set(ids).size)
      throw new Error("DRAFT_RESOURCE_REGISTRY_MISSING");
    return rows;
  }
}
