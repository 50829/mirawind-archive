import type Database from "better-sqlite3";
import { createOpaqueId } from "@/domain/ids";
import type {
  CandidateBuildAttempt,
  CandidateBuildRetryCapture,
} from "../../application/commands/maintain-candidate-build";
import type {
  CurrentDraftCandidateRecord,
  CurrentDraftCandidateState,
} from "../../application/queries/get-draft";
import {
  candidateBuildIdentities,
  type BuildCandidateCommand,
} from "../../application/commands/build-candidate";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export type DraftCandidateState =
  "building" | "ready" | "failed" | "canceled" | "interrupted" | "discarded";
interface CandidateRow {
  id: string;
  book_id: number;
  import_id: string;
  input_rel_path: string;
  source_updated_at: number;
  job_id: string;
  version_id: string | null;
  state: DraftCandidateState;
  semantic_digest: string | null;
  safe_error_code: string | null;
  blocking_diagnostic_count: number | null;
  created_at: number;
  completed_at: number | null;
}
export interface DraftCandidateRecord extends Omit<
  CurrentDraftCandidateRecord,
  "state"
> {
  readonly bookId: number;
  readonly importId: string;
  readonly inputRelativePath: string;
  readonly jobId: string;
  readonly state: DraftCandidateState;
  readonly blockingDiagnosticCount: number | null;
  readonly createdAtMs: number;
  readonly completedAtMs: number | null;
}
export type CurrentCandidateRecord = Omit<DraftCandidateRecord, "state"> & {
  readonly state: CurrentDraftCandidateState;
};
function map(row: CandidateRow): DraftCandidateRecord {
  return {
    attemptId: row.id,
    bookId: row.book_id,
    importId: row.import_id,
    inputRelativePath: row.input_rel_path,
    sourceUpdatedAt: row.source_updated_at,
    jobId: row.job_id,
    versionId: row.version_id,
    state: row.state,
    semanticDigest: row.semantic_digest,
    safeErrorCode: row.safe_error_code,
    blockingDiagnosticCount: row.blocking_diagnostic_count,
    createdAtMs: row.created_at,
    completedAtMs: row.completed_at,
    previewUrl:
      row.state === "ready"
        ? "/api/manage/books/" + row.book_id + "/preview/" + row.id + "/pages/1"
        : null,
  };
}
export class DraftCandidateRepository {
  constructor(private readonly database: Database.Database) {}
  find(candidateId: string): DraftCandidateRecord | null {
    const row = this.database
      .prepare("SELECT * FROM draft_candidates WHERE id = ?")
      .get(candidateId) as CandidateRow | undefined;
    return row ? map(row) : null;
  }
  require(candidateId: string): DraftCandidateRecord {
    const candidate = this.find(candidateId);
    if (!candidate) throw new Error("DRAFT_CANDIDATE_NOT_FOUND");
    return candidate;
  }
  findReadable(
    candidateId: string,
    bookId: number,
  ): DraftCandidateRecord | null {
    const row = this.database
      .prepare(
        "SELECT candidate.* FROM draft_candidates candidate JOIN book_versions version ON version.id=candidate.version_id AND version.book_id=candidate.book_id JOIN books ON books.id=candidate.book_id WHERE candidate.id=? AND candidate.book_id=? AND candidate.state='ready' AND version.state<>'corrupt' AND version.reclaimed_at IS NULL AND books.deletion_requested_at IS NULL",
      )
      .get(candidateId, bookId) as CandidateRow | undefined;
    return row ? map(row) : null;
  }
  findCurrent(bookId: number): CurrentCandidateRecord | null {
    const row = this.database
      .prepare(
        "SELECT candidate.* FROM books JOIN draft_candidates candidate ON candidate.id = books.current_candidate_id AND candidate.book_id = books.id WHERE books.id = ? AND books.deletion_requested_at IS NULL AND candidate.state <> 'discarded'",
      )
      .get(bookId) as CandidateRow | undefined;
    return row ? (map(row) as CurrentCandidateRecord) : null;
  }
  createForDocument(input: {
    readonly bookId: number;
    readonly importId: string;
    readonly sourceUpdatedAt: number;
    readonly nowMs: number;
  }): DraftCandidateRecord {
    return withImmediateTransaction(this.database, () => {
      const book = this.database
        .prepare(
          "SELECT current_candidate_id, current_version_id FROM books WHERE id = ? AND deletion_requested_at IS NULL",
        )
        .get(input.bookId) as
        | {
            current_candidate_id: string | null;
            current_version_id: string | null;
          }
        | undefined;
      if (!book) throw new Error("BOOK_NOT_FOUND");
      if (book.current_candidate_id)
        this.discard(book.current_candidate_id, input.nowMs);
      const candidateId = createOpaqueId("draftCandidate");
      const jobId = createOpaqueId("job");
      const versionId = createOpaqueId("version");
      const inputPath =
        "books/" +
        input.bookId +
        "/draft/candidates/" +
        candidateId +
        "/book.json";
      this.database
        .prepare(
          "INSERT INTO jobs (id,kind,state,book_id,import_id,version_id,captured_input_path,captured_source_updated_at,captured_current_version_id,attempt,phase,created_at) VALUES (?,'build_candidate','queued',?,?,?,?,?,?,1,'queued',?)",
        )
        .run(
          jobId,
          input.bookId,
          input.importId,
          versionId,
          inputPath,
          input.sourceUpdatedAt,
          book.current_version_id,
          input.nowMs,
        );
      this.database
        .prepare(
          "INSERT INTO draft_candidates (id,book_id,import_id,source_updated_at,input_rel_path,job_id,state,created_at) VALUES (?,?,?,?,?,?,'building',?)",
        )
        .run(
          candidateId,
          input.bookId,
          input.importId,
          input.sourceUpdatedAt,
          inputPath,
          jobId,
          input.nowMs,
        );
      this.database
        .prepare("UPDATE jobs SET candidate_id = ? WHERE id = ?")
        .run(candidateId, jobId);
      this.database
        .prepare(
          "UPDATE books SET current_candidate_id = ?, draft_import_id = ? WHERE id = ?",
        )
        .run(candidateId, input.importId, input.bookId);
      return this.require(candidateId);
    });
  }
  private discard(candidateId: string, nowMs: number): void {
    this.database
      .prepare(
        "UPDATE book_versions SET state = 'discarded' WHERE id = (SELECT version_id FROM draft_candidates WHERE id = ?) AND state = 'ready'",
      )
      .run(candidateId);
    this.database
      .prepare(
        "UPDATE draft_candidates SET state = 'discarded', safe_error_code = 'CANDIDATE_SUPERSEDED', version_id = NULL, semantic_digest = NULL, blocking_diagnostic_count = NULL, completed_at = max(?, created_at) WHERE id = ? AND state = 'building'",
      )
      .run(nowMs, candidateId);
    this.database
      .prepare(
        "UPDATE jobs SET state = 'canceled', cancellation_requested_at = ?, finished_at = ?, error_class = 'canceled', error_code = 'CANDIDATE_SUPERSEDED', phase = 'canceled' WHERE candidate_id = ? AND state = 'queued'",
      )
      .run(nowMs, nowMs, candidateId);
    this.database
      .prepare(
        "UPDATE jobs SET cancellation_requested_at = COALESCE(cancellation_requested_at,?) WHERE candidate_id = ? AND state = 'running'",
      )
      .run(nowMs, candidateId);
  }
  captureRetry(job: CandidateBuildAttempt): CandidateBuildRetryCapture {
    const row = this.database
      .prepare(
        "SELECT books.current_candidate_id, books.current_version_id, candidate.state, candidate.source_updated_at FROM draft_candidates candidate JOIN books ON books.id = candidate.book_id WHERE candidate.id = ? AND candidate.job_id = ? AND candidate.book_id = ? AND books.deletion_requested_at IS NULL",
      )
      .get(job.candidateId, job.id, job.bookId) as
      | {
          current_candidate_id: string | null;
          current_version_id: string | null;
          source_updated_at: number;
          state: string;
        }
      | undefined;
    if (
      !row ||
      !["failed", "canceled", "interrupted"].includes(row.state) ||
      row.current_candidate_id !== job.candidateId ||
      row.source_updated_at !== job.capturedSourceUpdatedAt ||
      this.database
        .prepare(
          "SELECT 1 FROM jobs WHERE book_id = ? AND kind = 'save_draft' AND state IN ('queued','running')",
        )
        .get(job.bookId)
    )
      throw new Error("CANDIDATE_RETRY_STALE");
    return { currentVersionId: row.current_version_id };
  }
  createRetry(input: {
    readonly candidateId: string;
    readonly jobId: string;
    readonly nowMs: number;
    readonly original: CandidateBuildAttempt;
  }): void {
    const previous = input.original.candidateId
      ? this.require(input.original.candidateId)
      : null;
    if (
      !previous ||
      previous.bookId !== input.original.bookId ||
      previous.sourceUpdatedAt !== input.original.capturedSourceUpdatedAt
    )
      throw new Error("CANDIDATE_RETRY_INPUT_INVALID");
    const inputPath =
      "books/" +
      previous.bookId +
      "/draft/candidates/" +
      input.candidateId +
      "/book.json";
    this.database
      .prepare(
        "INSERT INTO draft_candidates (id,book_id,import_id,source_updated_at,input_rel_path,job_id,state,created_at) VALUES (?,?,?,?,?,?,'building',?)",
      )
      .run(
        input.candidateId,
        previous.bookId,
        previous.importId,
        previous.sourceUpdatedAt,
        inputPath,
        input.jobId,
        input.nowMs,
      );
    this.database
      .prepare("UPDATE jobs SET captured_input_path = ? WHERE id = ?")
      .run(inputPath, input.jobId);
    const changed = this.database
      .prepare(
        "UPDATE books SET current_candidate_id = ? WHERE id = ? AND current_candidate_id = ? AND deletion_requested_at IS NULL",
      )
      .run(input.candidateId, previous.bookId, previous.attemptId);
    if (changed.changes !== 1) throw new Error("CANDIDATE_RETRY_STALE");
  }
  terminalize(input: {
    readonly candidateId: string;
    readonly jobId: string;
    readonly nowMs: number;
    readonly safeErrorCode: string;
    readonly state: "canceled" | "failed" | "interrupted";
  }): void {
    this.database
      .prepare(
        "UPDATE draft_candidates SET state = ?, safe_error_code = ?, completed_at = max(?, created_at) WHERE id = ? AND job_id = ? AND state = 'building'",
      )
      .run(
        input.state,
        input.safeErrorCode,
        input.nowMs,
        input.candidateId,
        input.jobId,
      );
  }
  buildCommand(
    candidateId: string,
  ): Omit<BuildCandidateCommand, "documentSha256"> {
    const row = this.database
      .prepare(
        "SELECT candidate.*, jobs.version_id AS build_version_id, jobs.captured_current_version_id FROM draft_candidates candidate JOIN jobs ON jobs.id = candidate.job_id AND jobs.candidate_id = candidate.id WHERE candidate.id = ? AND candidate.state = 'building'",
      )
      .get(candidateId) as
      | (CandidateRow & {
          build_version_id: string;
          captured_current_version_id: string | null;
        })
      | undefined;
    if (!row?.build_version_id)
      throw new Error("BUILD_CANDIDATE_INPUT_INVALID");
    return {
      bookId: row.book_id,
      candidateId: row.id,
      capturedCurrentVersionId: row.captured_current_version_id,
      compilerIdentity: candidateBuildIdentities.compiler,
      inputRelativePath: row.input_rel_path,
      sourceUpdatedAt: row.source_updated_at,
      jobId: row.job_id,
      kind: "build_candidate",
      previewIdentity: candidateBuildIdentities.preview,
      readerIdentity: candidateBuildIdentities.reader,
      rendererIdentity: candidateBuildIdentities.renderer,
      importId: row.import_id,
      resourceRootRelativePath: "books/" + row.book_id,
      versionId: row.build_version_id,
    };
  }
}
