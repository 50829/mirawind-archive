import type Database from "better-sqlite3";

import { createOpaqueId } from "@/domain/ids";
import type {
  CurrentDraftCandidateRecord,
  CurrentDraftCandidateState,
} from "@/modules/publishing/application/public";
import { candidateBuildIdentities } from "@/modules/publishing/application/public";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export type DraftCandidateState =
  "building" | "ready" | "failed" | "canceled" | "interrupted" | "discarded";

interface CandidateRow {
  blocking_diagnostic_count: number | null;
  book_id: number;
  completed_at: number | null;
  config_revision: number;
  created_at: number;
  id: string;
  job_id: string;
  safe_error_code: string | null;
  semantic_digest: string | null;
  source_id: string;
  state: DraftCandidateState;
  version_id: string | null;
}

export interface DraftCandidateRecord extends Omit<
  CurrentDraftCandidateRecord,
  "state"
> {
  readonly blockingDiagnosticCount: number | null;
  readonly bookId: number;
  readonly completedAtMs: number | null;
  readonly createdAtMs: number;
  readonly jobId: string;
  readonly sourceId: string;
  readonly state: DraftCandidateState;
}

export type CurrentCandidateRecord = Omit<DraftCandidateRecord, "state"> & {
  readonly state: CurrentDraftCandidateState;
};

function previewUrl(row: CandidateRow): string | null {
  return row.state === "ready"
    ? `/api/manage/books/${row.book_id}/preview/${row.config_revision}/pages/1`
    : null;
}

function mapCandidate(row: CandidateRow): DraftCandidateRecord {
  return Object.freeze({
    attemptId: row.id,
    blockingDiagnosticCount: row.blocking_diagnostic_count,
    bookId: row.book_id,
    completedAtMs: row.completed_at,
    configRevision: row.config_revision,
    createdAtMs: row.created_at,
    jobId: row.job_id,
    previewUrl: previewUrl(row),
    safeErrorCode: row.safe_error_code,
    semanticDigest: row.semantic_digest,
    sourceId: row.source_id,
    state: row.state,
    versionId: row.version_id,
  });
}

export class DraftCandidateRepository {
  constructor(private readonly database: Database.Database) {}

  private createForCurrentRevisionInTransaction(input: {
    readonly bookId: number;
    readonly configRevision: number;
    readonly importId?: string;
    readonly nowMs: number;
    readonly sourceId: string;
  }): DraftCandidateRecord {
    const current = this.database
      .prepare(
        `SELECT current_candidate_id, current_version_id
         FROM books
         WHERE id = ? AND draft_source_id = ? AND draft_config_revision = ?
           AND deletion_requested_at IS NULL`,
      )
      .get(input.bookId, input.sourceId, input.configRevision) as
      | {
          current_candidate_id: string | null;
          current_version_id: string | null;
        }
      | undefined;
    if (!current) throw new Error("CONFIG_REVISION_CONFLICT");

    if (current.current_candidate_id) {
      this.database
        .prepare(
          `UPDATE draft_candidates
           SET state = 'discarded', safe_error_code = 'CANDIDATE_SUPERSEDED',
               completed_at = ?
           WHERE id = ? AND state IN ('building', 'ready')`,
        )
        .run(input.nowMs, current.current_candidate_id);
      this.database
        .prepare(
          `UPDATE book_versions SET state = 'discarded'
           WHERE id = (
             SELECT version_id FROM draft_candidates WHERE id = ?
           ) AND state = 'ready'`,
        )
        .run(current.current_candidate_id);
      this.database
        .prepare(
          `UPDATE jobs
           SET state = 'canceled', cancellation_requested_at = ?,
               finished_at = ?, error_class = 'canceled',
               error_code = 'CANDIDATE_SUPERSEDED', phase = 'canceled'
           WHERE id = (
             SELECT job_id FROM draft_candidates WHERE id = ?
           ) AND state = 'queued'`,
        )
        .run(input.nowMs, input.nowMs, current.current_candidate_id);
      this.database
        .prepare(
          `UPDATE jobs
           SET cancellation_requested_at = COALESCE(cancellation_requested_at, ?)
           WHERE id = (
             SELECT job_id FROM draft_candidates WHERE id = ?
           ) AND state = 'running'`,
        )
        .run(input.nowMs, current.current_candidate_id);
    }

    const candidateId = createOpaqueId("draftCandidate");
    const jobId = createOpaqueId("job");
    const versionId = createOpaqueId("version");
    this.database
      .prepare(
        `INSERT INTO jobs (
          id, kind, state, import_id, book_id, candidate_id, version_id,
          captured_source_id, captured_config_revision,
          captured_current_version_id, retry_of_job_id, attempt,
          automatic_retry_count, lease_owner, lease_until, heartbeat_at,
          phase, progress_json, error_code, error_class, error_detail_json,
          cancellation_requested_at, created_at, started_at, finished_at
        ) VALUES (
          ?, 'build_candidate', 'queued', ?, ?, NULL, ?, ?, ?, ?, NULL, 1,
          0, NULL, NULL, NULL, 'queued', ?, NULL, NULL, NULL,
          NULL, ?, NULL, NULL
        )`,
      )
      .run(
        jobId,
        input.importId ?? null,
        input.bookId,
        versionId,
        input.sourceId,
        input.configRevision,
        current.current_version_id,
        JSON.stringify({
          completed: 0,
          processed_bytes: null,
          total: null,
          unit: "steps",
        }),
        input.nowMs,
      );
    this.database
      .prepare(
        `INSERT INTO draft_candidates (
          id, book_id, source_id, config_revision, job_id, version_id,
          state, semantic_digest, safe_error_code,
          blocking_diagnostic_count, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, NULL, 'building', NULL, NULL, NULL, ?, NULL)`,
      )
      .run(
        candidateId,
        input.bookId,
        input.sourceId,
        input.configRevision,
        jobId,
        input.nowMs,
      );
    this.database
      .prepare("UPDATE jobs SET candidate_id = ? WHERE id = ?")
      .run(candidateId, jobId);
    const changed = this.database
      .prepare(
        `UPDATE books SET current_candidate_id = ?, updated_at = ?
         WHERE id = ? AND draft_source_id = ? AND draft_config_revision = ?
           AND deletion_requested_at IS NULL`,
      )
      .run(
        candidateId,
        input.nowMs,
        input.bookId,
        input.sourceId,
        input.configRevision,
      );
    if (changed.changes !== 1) throw new Error("CONFIG_REVISION_CONFLICT");
    return this.require(candidateId);
  }

  find(candidateId: string): DraftCandidateRecord | null {
    const row = this.database
      .prepare("SELECT * FROM draft_candidates WHERE id = ?")
      .get(candidateId) as CandidateRow | undefined;
    return row ? mapCandidate(row) : null;
  }

  findCurrent(bookId: number): CurrentCandidateRecord | null {
    const row = this.database
      .prepare(
        `SELECT candidate.* FROM books
         JOIN draft_candidates AS candidate
           ON candidate.id = books.current_candidate_id
          AND candidate.book_id = books.id
          AND candidate.config_revision = books.draft_config_revision
          AND candidate.source_id = books.draft_source_id
          AND candidate.state <> 'discarded'
         WHERE books.id = ? AND books.deletion_requested_at IS NULL`,
      )
      .get(bookId) as CandidateRow | undefined;
    return row ? (mapCandidate(row) as CurrentCandidateRecord) : null;
  }

  createForCurrentRevision(input: {
    readonly bookId: number;
    readonly configRevision: number;
    readonly importId?: string;
    readonly nowMs: number;
    readonly sourceId: string;
  }): DraftCandidateRecord {
    return withImmediateTransaction(this.database, () =>
      this.createForCurrentRevisionInTransaction(input),
    );
  }

  replaceConfigAndCreate(input: {
    readonly bookId: number;
    readonly expectedRevision: number;
    readonly expectedYamlSha256: string;
    readonly nowMs: number;
    readonly revision: number;
    readonly schemaVersion: number;
    readonly sourceId: string;
    readonly title: string;
    readonly yamlRelativePath: string;
    readonly yamlSha256: string;
  }): DraftCandidateRecord {
    return withImmediateTransaction(this.database, () => {
      const current = this.database
        .prepare(
          `SELECT books.draft_config_revision AS revision,
                  books.draft_source_id AS source_id,
                  config_revisions.yaml_sha256 AS yaml_sha256
           FROM books
           JOIN config_revisions
             ON config_revisions.book_id = books.id
            AND config_revisions.revision = books.draft_config_revision
           WHERE books.id = ? AND books.deletion_requested_at IS NULL`,
        )
        .get(input.bookId) as
        | { revision: number; source_id: string; yaml_sha256: string }
        | undefined;
      if (
        !current ||
        input.revision !== input.expectedRevision + 1 ||
        current.revision !== input.expectedRevision ||
        current.source_id !== input.sourceId ||
        current.yaml_sha256 !== input.expectedYamlSha256
      ) {
        throw new Error("CONFIG_REVISION_CONFLICT");
      }
      this.database
        .prepare(
          `INSERT INTO config_revisions (
            book_id, revision, source_id, schema_version,
            yaml_rel_path, yaml_sha256, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.bookId,
          input.revision,
          input.sourceId,
          input.schemaVersion,
          input.yamlRelativePath,
          input.yamlSha256,
          input.nowMs,
        );
      const changed = this.database
        .prepare(
          `UPDATE books
           SET draft_config_revision = ?, title_cache = ?, updated_at = ?
           WHERE id = ? AND draft_config_revision = ? AND draft_source_id = ?
             AND deletion_requested_at IS NULL`,
        )
        .run(
          input.revision,
          input.title,
          input.nowMs,
          input.bookId,
          input.expectedRevision,
          input.sourceId,
        );
      if (changed.changes !== 1) throw new Error("CONFIG_REVISION_CONFLICT");
      return this.createForCurrentRevisionInTransaction({
        bookId: input.bookId,
        configRevision: input.revision,
        nowMs: input.nowMs,
        sourceId: input.sourceId,
      });
    });
  }

  addInitialConfigAndCreate(input: {
    readonly bookId: number;
    readonly importId: string;
    readonly nowMs: number;
    readonly revision: number;
    readonly schemaVersion: number;
    readonly sourceId: string;
    readonly title: string;
    readonly yamlRelativePath: string;
    readonly yamlSha256: string;
  }): DraftCandidateRecord {
    return withImmediateTransaction(this.database, () => {
      const current = this.database
        .prepare(
          `SELECT draft_source_id, draft_config_revision
           FROM books
           WHERE id = ? AND deletion_requested_at IS NULL`,
        )
        .get(input.bookId) as
        | {
            draft_config_revision: number | null;
            draft_source_id: string | null;
          }
        | undefined;
      if (
        !current ||
        current.draft_config_revision !== null ||
        current.draft_source_id !== null ||
        input.revision !== 1
      ) {
        throw new Error("CONFIG_REVISION_CONFLICT");
      }
      this.database
        .prepare(
          `INSERT INTO config_revisions (
            book_id, revision, source_id, schema_version,
            yaml_rel_path, yaml_sha256, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.bookId,
          input.revision,
          input.sourceId,
          input.schemaVersion,
          input.yamlRelativePath,
          input.yamlSha256,
          input.nowMs,
        );
      const changed = this.database
        .prepare(
          `UPDATE books
           SET draft_source_id = ?, draft_config_revision = ?,
               title_cache = ?, updated_at = ?
           WHERE id = ? AND draft_source_id IS NULL
             AND draft_config_revision IS NULL
             AND deletion_requested_at IS NULL`,
        )
        .run(
          input.sourceId,
          input.revision,
          input.title,
          input.nowMs,
          input.bookId,
        );
      if (changed.changes !== 1) throw new Error("CONFIG_REVISION_CONFLICT");
      return this.createForCurrentRevisionInTransaction({
        bookId: input.bookId,
        configRevision: input.revision,
        importId: input.importId,
        nowMs: input.nowMs,
        sourceId: input.sourceId,
      });
    });
  }

  replaceSourceConfigAndCreate(input: {
    readonly bookId: number;
    readonly expectedRevision: number;
    readonly expectedSourceId: string;
    readonly expectedYamlSha256: string;
    readonly importId: string;
    readonly newSourceId: string;
    readonly nowMs: number;
    readonly revision: number;
    readonly schemaVersion: number;
    readonly title: string;
    readonly yamlRelativePath: string;
    readonly yamlSha256: string;
  }): DraftCandidateRecord {
    return withImmediateTransaction(this.database, () => {
      const current = this.database
        .prepare(
          `SELECT books.draft_config_revision AS revision,
                  books.draft_source_id AS source_id,
                  config_revisions.yaml_sha256 AS yaml_sha256
           FROM books
           JOIN config_revisions
             ON config_revisions.book_id = books.id
            AND config_revisions.revision = books.draft_config_revision
           WHERE books.id = ? AND books.deletion_requested_at IS NULL`,
        )
        .get(input.bookId) as
        | { revision: number; source_id: string; yaml_sha256: string }
        | undefined;
      if (
        !current ||
        input.revision !== input.expectedRevision + 1 ||
        current.revision !== input.expectedRevision ||
        current.source_id !== input.expectedSourceId ||
        current.yaml_sha256 !== input.expectedYamlSha256
      ) {
        throw new Error("CONFIG_REVISION_CONFLICT");
      }
      this.database
        .prepare(
          `INSERT INTO config_revisions (
            book_id, revision, source_id, schema_version,
            yaml_rel_path, yaml_sha256, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.bookId,
          input.revision,
          input.newSourceId,
          input.schemaVersion,
          input.yamlRelativePath,
          input.yamlSha256,
          input.nowMs,
        );
      const changed = this.database
        .prepare(
          `UPDATE books
           SET draft_source_id = ?, draft_config_revision = ?,
               title_cache = ?, updated_at = ?
           WHERE id = ? AND draft_config_revision = ? AND draft_source_id = ?
             AND deletion_requested_at IS NULL`,
        )
        .run(
          input.newSourceId,
          input.revision,
          input.title,
          input.nowMs,
          input.bookId,
          input.expectedRevision,
          input.expectedSourceId,
        );
      if (changed.changes !== 1) throw new Error("CONFIG_REVISION_CONFLICT");
      return this.createForCurrentRevisionInTransaction({
        bookId: input.bookId,
        configRevision: input.revision,
        importId: input.importId,
        nowMs: input.nowMs,
        sourceId: input.newSourceId,
      });
    });
  }

  require(candidateId: string): DraftCandidateRecord {
    const candidate = this.find(candidateId);
    if (!candidate) throw new Error("DRAFT_CANDIDATE_NOT_FOUND");
    return candidate;
  }

  buildCommand(candidateId: string) {
    const row = this.database
      .prepare(
        `SELECT candidate.*, jobs.version_id, jobs.captured_current_version_id,
                config_revisions.yaml_rel_path,
                source_snapshots.source_root_rel_path
         FROM draft_candidates AS candidate
         JOIN jobs ON jobs.id = candidate.job_id
          AND jobs.candidate_id = candidate.id
         JOIN config_revisions
           ON config_revisions.book_id = candidate.book_id
          AND config_revisions.revision = candidate.config_revision
          AND config_revisions.source_id = candidate.source_id
         JOIN source_snapshots ON source_snapshots.id = candidate.source_id
         WHERE candidate.id = ? AND candidate.state = 'building'`,
      )
      .get(candidateId) as
      | (CandidateRow & {
          captured_current_version_id: string | null;
          source_root_rel_path: string;
          version_id: string;
          yaml_rel_path: string;
        })
      | undefined;
    if (!row?.version_id) throw new Error("BUILD_CANDIDATE_INPUT_INVALID");
    return Object.freeze({
      bookId: row.book_id,
      candidateId: row.id,
      capturedCurrentVersionId: row.captured_current_version_id,
      compilerIdentity: candidateBuildIdentities.compiler,
      configRelativePath: row.yaml_rel_path,
      configRevision: row.config_revision,
      jobId: row.job_id,
      kind: "build_candidate" as const,
      previewIdentity: candidateBuildIdentities.preview,
      readerIdentity: candidateBuildIdentities.reader,
      rendererIdentity: candidateBuildIdentities.renderer,
      sourceId: row.source_id,
      sourceRootRelativePath: row.source_root_rel_path,
      versionId: row.version_id,
    });
  }
}
