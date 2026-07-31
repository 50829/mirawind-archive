import type Database from "better-sqlite3";

import { hasControlCharacters } from "@/domain/text";
import type {
  CandidateDiagnostic,
  MarkdownCandidate,
} from "@/modules/publishing/adapters/filesystem/discover-markdown-candidates";
import { createOpaqueId } from "@/domain/ids";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import type { TypographyProfile } from "@/modules/publishing/core/preparation/document-model";

export type ImportState =
  | "uploaded"
  | "analyzing"
  | "needs_main_confirmation"
  | "preparing"
  | "draft_ready"
  | "rejected"
  | "canceled"
  | "expired";
export type CandidateConfidence = "ambiguous" | "generic" | "high";

interface ImportRow {
  book_id: number | null;
  created_at: number;
  expires_at: number;
  id: string;
  original_name: string;
  safe_error_code: string | null;
  selected_candidate_id: string | null;
  state: ImportState;
  updated_at: number;
  upload_rel_path: string;
  upload_sha256: string;
  upload_size_bytes: number;
}

interface CandidateRow {
  confidence: CandidateConfidence;
  diagnostics_json: string;
  evidence_json: string;
  id: string;
  import_id: string;
  normalized_path: string;
  score: number;
}

export interface ImportRecord {
  readonly bookId: number | null;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly id: string;
  readonly originalName: string;
  readonly safeErrorCode: string | null;
  readonly selectedCandidateId: string | null;
  readonly state: ImportState;
  readonly updatedAtMs: number;
  readonly uploadRelativePath: string;
  readonly uploadSha256: string;
  readonly uploadSizeBytes: number;
}

export interface ImportCandidateRecord {
  readonly confidence: CandidateConfidence;
  readonly diagnostics: readonly CandidateDiagnostic[];
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly id: string;
  readonly importId: string;
  readonly normalizedPath: string;
  readonly score: number;
}

export interface ReprocessPreparationEvidence {
  readonly expectedConfigRevision: number;
  readonly expectedSourceId: string;
  readonly kind: "reprocess";
  readonly originalFileId: string;
  readonly typographyProfile: TypographyProfile;
}

function mapImport(row: ImportRow): ImportRecord {
  return Object.freeze({
    bookId: row.book_id,
    createdAtMs: row.created_at,
    expiresAtMs: row.expires_at,
    id: row.id,
    originalName: row.original_name,
    safeErrorCode: row.safe_error_code,
    selectedCandidateId: row.selected_candidate_id,
    state: row.state,
    updatedAtMs: row.updated_at,
    uploadRelativePath: row.upload_rel_path,
    uploadSha256: row.upload_sha256,
    uploadSizeBytes: row.upload_size_bytes,
  });
}

function mapCandidate(row: CandidateRow): ImportCandidateRecord {
  return Object.freeze({
    confidence: row.confidence,
    diagnostics: JSON.parse(row.diagnostics_json) as CandidateDiagnostic[],
    evidence: JSON.parse(row.evidence_json) as Readonly<
      Record<string, unknown>
    >,
    id: row.id,
    importId: row.import_id,
    normalizedPath: row.normalized_path,
    score: row.score,
  });
}

function validateSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("SHA256_INVALID");
}

function validateSafeErrorCode(value: string): void {
  if (!/^[A-Z][A-Z0-9_]{2,79}$/u.test(value)) {
    throw new Error("IMPORT_ERROR_CODE_INVALID");
  }
}

export class ImportRepository {
  constructor(private readonly database: Database.Database) {}

  createUploaded(input: {
    readonly bookId?: number;
    readonly expiresAtMs: number;
    readonly id?: string;
    readonly nowMs: number;
    readonly originalName: string;
    readonly uploadRelativePath: string;
    readonly uploadSha256: string;
    readonly uploadSizeBytes: number;
  }): ImportRecord {
    validateSha256(input.uploadSha256);
    if (
      [...input.originalName].length < 1 ||
      [...input.originalName].length > 255 ||
      hasControlCharacters(input.originalName)
    ) {
      throw new Error("IMPORT_ORIGINAL_NAME_INVALID");
    }
    const id = input.id ?? createOpaqueId("import");
    this.database
      .prepare(
        `INSERT INTO imports (
          id, original_name, state, upload_rel_path, upload_size_bytes, upload_sha256,
          selected_candidate_id, book_id, safe_error_code,
          created_at, updated_at, expires_at
        ) VALUES (?, ?, 'uploaded', ?, ?, ?, NULL, ?, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.originalName,
        input.uploadRelativePath,
        input.uploadSizeBytes,
        input.uploadSha256,
        input.bookId ?? null,
        input.nowMs,
        input.nowMs,
        input.expiresAtMs,
      );
    return this.require(id);
  }

  find(id: string): ImportRecord | null {
    const row = this.database
      .prepare("SELECT * FROM imports WHERE id = ?")
      .get(id) as ImportRow | undefined;
    return row ? mapImport(row) : null;
  }

  require(id: string): ImportRecord {
    const record = this.find(id);
    if (!record) throw new Error("IMPORT_NOT_FOUND");
    return record;
  }

  candidates(importId: string): readonly ImportCandidateRecord[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM import_candidates
           WHERE import_id = ?
           ORDER BY score DESC, id`,
        )
        .all(importId) as CandidateRow[]
    ).map(mapCandidate);
  }

  startAnalysis(importId: string, nowMs: number): ImportRecord {
    const current = this.require(importId);
    if (current.state === "analyzing") return current;
    this.transition(importId, "uploaded", "analyzing", nowMs);
    return this.require(importId);
  }

  saveCandidates(input: {
    readonly candidates: readonly MarkdownCandidate[];
    readonly importId: string;
    readonly nextState: "needs_main_confirmation" | "preparing";
    readonly nowMs: number;
    readonly preparation?: ReprocessPreparationEvidence;
    readonly selectedCandidateId: string | null;
  }): ImportRecord {
    return withImmediateTransaction(this.database, () => {
      const current = this.require(input.importId);
      if (current.state !== "analyzing") {
        throw new Error("IMPORT_STATE_CONFLICT");
      }
      if (input.nextState === "preparing" && !input.selectedCandidateId) {
        throw new Error("IMPORT_SELECTED_CANDIDATE_REQUIRED");
      }
      const insert = this.database.prepare(
        `INSERT INTO import_candidates (
          id, import_id, normalized_path, confidence, score,
          evidence_json, diagnostics_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const candidate of input.candidates) {
        insert.run(
          candidate.id,
          input.importId,
          candidate.normalizedPath,
          candidate.confidence,
          candidate.score,
          JSON.stringify({
            byteSize: candidate.byteSize,
            companionFiles: candidate.companionFiles,
            firstHeading: candidate.firstHeading,
            ...(input.preparation ? { preparation: input.preparation } : {}),
            referencedResources: candidate.referencedResources,
          }),
          JSON.stringify(candidate.diagnostics),
        );
      }
      const result = this.database
        .prepare(
          `UPDATE imports
           SET state = ?, selected_candidate_id = ?, updated_at = ?
           WHERE id = ? AND state = 'analyzing'
             AND (
               ? IS NULL OR EXISTS (
                 SELECT 1 FROM import_candidates
                 WHERE import_id = imports.id AND id = ?
               )
             )`,
        )
        .run(
          input.nextState,
          input.selectedCandidateId,
          input.nowMs,
          input.importId,
          input.selectedCandidateId,
          input.selectedCandidateId,
        );
      if (result.changes !== 1) throw new Error("IMPORT_CANDIDATE_INVALID");
      return this.require(input.importId);
    });
  }

  confirmCandidate(input: {
    readonly candidateId: string;
    readonly importId: string;
    readonly nowMs: number;
  }): ImportRecord {
    const result = this.database
      .prepare(
        `UPDATE imports
         SET state = 'preparing', selected_candidate_id = ?, updated_at = ?
         WHERE id = ? AND state = 'needs_main_confirmation'
           AND EXISTS (
             SELECT 1 FROM import_candidates
             WHERE import_id = imports.id AND id = ?
           )`,
      )
      .run(input.candidateId, input.nowMs, input.importId, input.candidateId);
    if (result.changes !== 1) throw new Error("IMPORT_CONFIRMATION_CONFLICT");
    return this.require(input.importId);
  }

  attachBookForPreparation(input: {
    readonly bookId: number;
    readonly importId: string;
    readonly nowMs: number;
  }): ImportRecord {
    return withImmediateTransaction(this.database, () => {
      const result = this.database
        .prepare(
          `UPDATE imports
           SET book_id = ?, updated_at = ?
           WHERE id = ? AND state = 'preparing'
             AND (book_id IS NULL OR book_id = ?)`,
        )
        .run(input.bookId, input.nowMs, input.importId, input.bookId);
      if (result.changes !== 1) throw new Error("IMPORT_STATE_CONFLICT");
      this.scopeJobsToBook(input.importId, input.bookId);
      return this.require(input.importId);
    });
  }

  attachPreparedBook(input: {
    readonly bookId: number;
    readonly importId: string;
    readonly nowMs: number;
  }): ImportRecord {
    return withImmediateTransaction(this.database, () => {
      const result = this.database
        .prepare(
          `UPDATE imports
           SET state = 'draft_ready', book_id = ?, updated_at = ?
           WHERE id = ? AND state = 'preparing'
             AND (book_id IS NULL OR book_id = ?)`,
        )
        .run(input.bookId, input.nowMs, input.importId, input.bookId);
      if (result.changes !== 1) throw new Error("IMPORT_STATE_CONFLICT");
      this.scopeJobsToBook(input.importId, input.bookId);
      return this.require(input.importId);
    });
  }

  private scopeJobsToBook(importId: string, bookId: number): void {
    const conflict = this.database
      .prepare(
        `SELECT 1 FROM jobs
         WHERE import_id = ? AND book_id IS NOT NULL AND book_id != ?
         LIMIT 1`,
      )
      .get(importId, bookId);
    if (conflict) throw new Error("IMPORT_BOOK_SCOPE_CONFLICT");
    this.database
      .prepare(
        "UPDATE jobs SET book_id = ? WHERE import_id = ? AND book_id IS NULL",
      )
      .run(bookId, importId);
  }

  reject(importId: string, errorCode: string, nowMs: number): ImportRecord {
    validateSafeErrorCode(errorCode);
    const result = this.database
      .prepare(
        `UPDATE imports
         SET state = 'rejected', safe_error_code = ?, updated_at = ?
         WHERE id = ? AND state IN (
           'uploaded', 'analyzing', 'needs_main_confirmation', 'preparing'
         )`,
      )
      .run(errorCode, nowMs, importId);
    if (result.changes !== 1) throw new Error("IMPORT_STATE_CONFLICT");
    return this.require(importId);
  }

  cancel(importId: string, nowMs: number): ImportRecord {
    const result = this.database
      .prepare(
        `UPDATE imports
         SET state = 'canceled', updated_at = ?
         WHERE id = ? AND state IN (
           'uploaded', 'analyzing', 'needs_main_confirmation', 'preparing'
         )`,
      )
      .run(nowMs, importId);
    if (result.changes !== 1) throw new Error("IMPORT_STATE_CONFLICT");
    return this.require(importId);
  }

  saveRejectedCandidates(input: {
    readonly candidates: readonly MarkdownCandidate[];
    readonly errorCode: string;
    readonly importId: string;
    readonly nowMs: number;
  }): ImportRecord {
    validateSafeErrorCode(input.errorCode);
    return withImmediateTransaction(this.database, () => {
      const current = this.require(input.importId);
      if (current.state !== "analyzing") {
        throw new Error("IMPORT_STATE_CONFLICT");
      }
      const insert = this.database.prepare(
        `INSERT INTO import_candidates (
          id, import_id, normalized_path, confidence, score,
          evidence_json, diagnostics_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const candidate of input.candidates) {
        insert.run(
          candidate.id,
          input.importId,
          candidate.normalizedPath,
          candidate.confidence,
          candidate.score,
          JSON.stringify({
            byteSize: candidate.byteSize,
            companionFiles: candidate.companionFiles,
            firstHeading: candidate.firstHeading,
            referencedResources: candidate.referencedResources,
          }),
          JSON.stringify(candidate.diagnostics),
        );
      }
      const changed = this.database
        .prepare(
          `UPDATE imports
           SET state = 'rejected', safe_error_code = ?, updated_at = ?
           WHERE id = ? AND state = 'analyzing'`,
        )
        .run(input.errorCode, input.nowMs, input.importId);
      if (changed.changes !== 1) throw new Error("IMPORT_STATE_CONFLICT");
      return this.require(input.importId);
    });
  }

  private transition(
    importId: string,
    from: ImportState,
    to: ImportState,
    nowMs: number,
  ): void {
    const result = this.database
      .prepare(
        "UPDATE imports SET state = ?, updated_at = ? WHERE id = ? AND state = ?",
      )
      .run(to, nowMs, importId, from);
    if (result.changes !== 1) throw new Error("IMPORT_STATE_CONFLICT");
  }
}
