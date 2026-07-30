import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import { createOpaqueId } from "@/domain/ids";
import {
  assertJobTransition,
  assertJobPhase,
  isTerminalJobState,
  jobKinds,
  type JobKind,
  type JobState,
  type TerminalJobState,
} from "@/modules/publishing/application/job-state";
import { isJobProgress, type JobProgress } from "@/entrypoints/worker/protocol";

export { jobKinds, type JobKind };
export type JobErrorClass =
  | "infrastructure"
  | "content"
  | "validation"
  | "security_limit"
  | "timeout"
  | "canceled";

interface JobRow {
  attempt: number;
  automatic_retry_count: number;
  book_id: number | null;
  candidate_id: string | null;
  captured_config_revision: number | null;
  captured_current_version_id: string | null;
  captured_source_id: string | null;
  created_at: number;
  error_class: JobErrorClass | null;
  error_code: string | null;
  error_detail_json: string | null;
  finished_at: number | null;
  heartbeat_at: number | null;
  id: string;
  import_id: string | null;
  kind: JobKind;
  lease_owner: string | null;
  lease_until: number | null;
  phase: string;
  progress_json: string;
  cancellation_requested_at: number | null;
  retry_of_job_id: string | null;
  started_at: number | null;
  state: JobState;
  version_id: string | null;
}

export interface JobRecord {
  readonly attempt: number;
  readonly automaticRetryCount: number;
  readonly bookId: number | null;
  readonly candidateId: string | null;
  readonly capturedConfigRevision: number | null;
  readonly capturedCurrentVersionId: string | null;
  readonly capturedSourceId: string | null;
  readonly createdAtMs: number;
  readonly errorClass: JobErrorClass | null;
  readonly errorCode: string | null;
  readonly errorDetail: Readonly<Record<string, unknown>> | null;
  readonly finishedAtMs: number | null;
  readonly heartbeatAtMs: number | null;
  readonly id: string;
  readonly importId: string | null;
  readonly kind: JobKind;
  readonly leaseOwner: string | null;
  readonly leaseUntilMs: number | null;
  readonly phase: string;
  readonly progress: JobProgress;
  readonly cancellationRequestedAtMs: number | null;
  readonly retryOfJobId: string | null;
  readonly startedAtMs: number | null;
  readonly state: JobState;
  readonly versionId: string | null;
}

export interface CreateJobInput {
  readonly bookId?: number;
  readonly candidateId?: string;
  readonly capturedConfigRevision?: number;
  readonly capturedCurrentVersionId?: string;
  readonly capturedSourceId?: string;
  readonly idempotency?: {
    readonly key: string;
    readonly operation: string;
  };
  readonly importId?: string;
  readonly kind: JobKind;
  readonly nowMs?: number;
  readonly phase?: string;
  readonly versionId?: string;
}

function parseBoundedObject(
  value: string | null,
): Readonly<Record<string, unknown>> | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JOB_JSON_NOT_OBJECT");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function mapJob(row: JobRow): JobRecord {
  const parsedProgress = parseBoundedObject(row.progress_json);
  const progress = isJobProgress(parsedProgress)
    ? parsedProgress
    : {
        completed: 0,
        processed_bytes: null,
        total: null,
        unit: "steps" as const,
      };
  return {
    attempt: row.attempt,
    automaticRetryCount: row.automatic_retry_count,
    bookId: row.book_id,
    candidateId: row.candidate_id,
    capturedConfigRevision: row.captured_config_revision,
    capturedCurrentVersionId: row.captured_current_version_id,
    capturedSourceId: row.captured_source_id,
    createdAtMs: row.created_at,
    errorClass: row.error_class,
    errorCode: row.error_code,
    errorDetail: parseBoundedObject(row.error_detail_json),
    finishedAtMs: row.finished_at,
    heartbeatAtMs: row.heartbeat_at,
    id: row.id,
    importId: row.import_id,
    kind: row.kind,
    leaseOwner: row.lease_owner,
    leaseUntilMs: row.lease_until,
    phase: row.phase,
    progress,
    cancellationRequestedAtMs: row.cancellation_requested_at,
    retryOfJobId: row.retry_of_job_id,
    startedAtMs: row.started_at,
    state: row.state,
    versionId: row.version_id,
  };
}

function boundedJson(value: object): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > 65_536) {
    throw new Error("JOB_JSON_TOO_LARGE");
  }
  return json;
}

const initialProgress: JobProgress = Object.freeze({
  completed: 0,
  processed_bytes: null,
  total: null,
  unit: "steps",
});

function progressJson(value: JobProgress): string {
  if (!isJobProgress(value)) throw new Error("JOB_PROGRESS_INVALID");
  return boundedJson(value);
}

function validateSafeCode(value: string): void {
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(value)) {
    throw new Error("JOB_ERROR_CODE_INVALID");
  }
}

function idempotencyHash(key: string): string {
  if ([...key].length < 16 || [...key].length > 200) {
    throw new Error("IDEMPOTENCY_KEY_INVALID");
  }
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function validateOperation(operation: string): void {
  if (
    operation.length < 1 ||
    operation.length > 100 ||
    !/^[a-z][a-z0-9_.:-]*$/.test(operation)
  ) {
    throw new Error("IDEMPOTENCY_OPERATION_INVALID");
  }
}

export class JobRepository {
  constructor(private readonly database: Database.Database) {}

  findByIdempotency(operation: string, key: string): JobRecord | null {
    validateOperation(operation);
    const row = this.database
      .prepare(
        `SELECT jobs.* FROM job_idempotency_keys
         JOIN jobs ON jobs.id = job_idempotency_keys.job_id
         WHERE operation = ? AND key_sha256 = ?`,
      )
      .get(operation, idempotencyHash(key)) as JobRow | undefined;
    return row ? mapJob(row) : null;
  }

  create(input: CreateJobInput): JobRecord {
    if (
      ["build_candidate", "purge_book", "verify_version"].includes(
        input.kind,
      ) &&
      input.bookId === undefined
    ) {
      throw new Error("JOB_BOOK_SCOPE_REQUIRED");
    }
    if (
      ["reclaim_versions", "reconcile"].includes(input.kind) &&
      input.bookId !== undefined
    ) {
      throw new Error("JOB_BOOK_SCOPE_FORBIDDEN");
    }
    const nowMs = input.nowMs ?? Date.now();
    const operation = input.idempotency?.operation;
    const keySha256 = input.idempotency
      ? idempotencyHash(input.idempotency.key)
      : null;
    if (operation) validateOperation(operation);

    return this.database
      .transaction(() => {
        if (operation && keySha256) {
          const existing = this.database
            .prepare(
              `SELECT jobs.* FROM job_idempotency_keys
             JOIN jobs ON jobs.id = job_idempotency_keys.job_id
             WHERE operation = ? AND key_sha256 = ?`,
            )
            .get(operation, keySha256) as JobRow | undefined;
          if (existing) return mapJob(existing);
        }

        const id = createOpaqueId("job");
        const phase = input.phase ?? "queued";
        assertJobPhase(input.kind, phase);
        this.database
          .prepare(
            `INSERT INTO jobs (
            id, kind, state, import_id, book_id, candidate_id, version_id,
            captured_source_id, captured_config_revision,
            captured_current_version_id, attempt, automatic_retry_count,
            phase, progress_json, created_at
          ) VALUES (
            ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?
          )`,
          )
          .run(
            id,
            input.kind,
            input.importId ?? null,
            input.bookId ?? null,
            input.candidateId ?? null,
            input.versionId ?? null,
            input.capturedSourceId ?? null,
            input.capturedConfigRevision ?? null,
            input.capturedCurrentVersionId ?? null,
            phase,
            progressJson(initialProgress),
            nowMs,
          );
        if (operation && keySha256) {
          this.database
            .prepare(
              `INSERT INTO job_idempotency_keys
              (operation, key_sha256, job_id, created_at)
             VALUES (?, ?, ?, ?)`,
            )
            .run(operation, keySha256, id, nowMs);
        }
        return this.getRequired(id);
      })
      .immediate();
  }

  get(id: string): JobRecord | null {
    const row = this.database
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(id) as JobRow | undefined;
    return row ? mapJob(row) : null;
  }

  latestForImport(importId: string): JobRecord | null {
    const row = this.database
      .prepare(
        `SELECT * FROM jobs
         WHERE import_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(importId) as JobRow | undefined;
    return row ? mapJob(row) : null;
  }

  listRecent(limit = 50): readonly JobRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("JOB_LIST_LIMIT_INVALID");
    }
    const rows = this.database
      .prepare(
        `SELECT * FROM jobs
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(limit) as JobRow[];
    return Object.freeze(rows.map(mapJob));
  }

  private getRequired(id: string): JobRecord {
    const job = this.get(id);
    if (!job) throw new Error("JOB_NOT_FOUND");
    return job;
  }

  private terminalizeDraftCandidate(
    job: JobRecord,
    state: "canceled" | "failed" | "interrupted",
    safeErrorCode: string,
    nowMs: number,
  ): void {
    if (job.kind !== "build_candidate" || job.candidateId === null) {
      return;
    }
    const result = this.database
      .prepare(
        `UPDATE draft_candidates
         SET state = ?, safe_error_code = ?, completed_at = ?
         WHERE id = ? AND job_id = ? AND state = 'building'`,
      )
      .run(state, safeErrorCode, nowMs, job.candidateId, job.id);
    if (result.changes > 1) {
      throw new Error("DRAFT_CANDIDATE_TERMINAL_UPDATE_INVALID");
    }
  }

  claimNext(input: {
    readonly leaseOwner: string;
    readonly nowMs: number;
  }): JobRecord | null {
    return this.database
      .transaction(() => {
        if (
          this.database
            .prepare("SELECT 1 FROM jobs WHERE state = 'running' LIMIT 1")
            .get()
        ) {
          return null;
        }
        const candidate = this.database
          .prepare(
            `SELECT id FROM jobs
           WHERE state = 'queued'
           ORDER BY created_at, id LIMIT 1`,
          )
          .get() as { id: string } | undefined;
        if (!candidate) return null;
        const result = this.database
          .prepare(
            `UPDATE jobs
           SET state = 'running', lease_owner = ?, heartbeat_at = ?,
               lease_until = ?, started_at = ?, phase = 'starting'
           WHERE id = ? AND state = 'queued'`,
          )
          .run(
            input.leaseOwner,
            input.nowMs,
            input.nowMs + 60_000,
            input.nowMs,
            candidate.id,
          );
        return result.changes === 1 ? this.getRequired(candidate.id) : null;
      })
      .immediate();
  }

  heartbeat(input: {
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly nowMs: number;
    readonly phase?: string;
    readonly progress?: JobProgress;
  }): JobRecord {
    if (input.phase) {
      const job = this.getRequired(input.jobId);
      assertJobPhase(job.kind, input.phase);
    }
    const progress = input.progress ? progressJson(input.progress) : null;
    const result = this.database
      .prepare(
        `UPDATE jobs SET heartbeat_at = ?, lease_until = ?,
           phase = COALESCE(?, phase), progress_json = COALESCE(?, progress_json)
         WHERE id = ? AND state = 'running' AND lease_owner = ?`,
      )
      .run(
        input.nowMs,
        input.nowMs + 60_000,
        input.phase ?? null,
        progress,
        input.jobId,
        input.leaseOwner,
      );
    if (result.changes !== 1) throw new Error("JOB_LEASE_NOT_OWNED");
    return this.getRequired(input.jobId);
  }

  requestCancellation(id: string, nowMs: number): JobRecord {
    return this.database
      .transaction(() => {
        const current = this.getRequired(id);
        if (isTerminalJobState(current.state)) {
          throw new Error("JOB_ALREADY_TERMINAL");
        }
        if (current.state === "queued") {
          assertJobTransition(current.state, "canceled");
          this.database
            .prepare(
              `UPDATE jobs SET state = 'canceled', cancellation_requested_at = ?,
             finished_at = ?, error_class = 'canceled',
             error_code = 'JOB_CANCELED', phase = 'canceled'
             WHERE id = ? AND state = 'queued'`,
            )
            .run(nowMs, nowMs, id);
          this.terminalizeDraftCandidate(
            current,
            "canceled",
            "JOB_CANCELED",
            nowMs,
          );
        } else {
          this.database
            .prepare(
              `UPDATE jobs SET cancellation_requested_at = ?
             WHERE id = ? AND state = 'running'
               AND cancellation_requested_at IS NULL`,
            )
            .run(nowMs, id);
        }
        return this.getRequired(id);
      })
      .immediate();
  }

  completeSuccess(input: {
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly nowMs: number;
    readonly progress?: JobProgress;
    readonly versionId?: string;
  }): JobRecord {
    return this.completeOwned({
      ...input,
      nextState: "succeeded",
      phase: "complete",
      progress: input.progress ?? this.getRequired(input.jobId).progress,
    });
  }

  completeFailure(input: {
    readonly errorClass: JobErrorClass;
    readonly errorCode: string;
    readonly errorDetail?: Readonly<Record<string, unknown>>;
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly nowMs: number;
  }): JobRecord {
    validateSafeCode(input.errorCode);
    const nextState: TerminalJobState =
      input.errorClass === "canceled" ? "canceled" : "failed";
    const current = this.getRequired(input.jobId);
    const completed = this.completeOwned({
      ...input,
      errorDetail: input.errorDetail ?? {},
      nextState,
      phase: nextState,
      progress: current.progress,
    });
    return completed;
  }

  completeInterruption(input: {
    readonly errorCode: string;
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly nowMs: number;
  }): JobRecord {
    validateSafeCode(input.errorCode);
    const current = this.getRequired(input.jobId);
    return this.completeOwned({
      errorClass: "infrastructure",
      errorCode: input.errorCode,
      errorDetail: {},
      jobId: input.jobId,
      leaseOwner: input.leaseOwner,
      nextState: "interrupted",
      nowMs: input.nowMs,
      phase: "interrupted",
      progress: current.progress,
    });
  }

  private completeOwned(input: {
    readonly errorClass?: JobErrorClass;
    readonly errorCode?: string;
    readonly errorDetail?: Readonly<Record<string, unknown>>;
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly nextState: TerminalJobState;
    readonly nowMs: number;
    readonly phase: string;
    readonly progress: JobProgress;
    readonly versionId?: string;
  }): JobRecord {
    return this.database
      .transaction(() => {
        const current = this.getRequired(input.jobId);
        assertJobTransition(current.state, input.nextState);
        assertJobPhase(current.kind, input.phase);
        const result = this.database
          .prepare(
            `UPDATE jobs SET state = ?, phase = ?, progress_json = ?,
               error_class = ?, error_code = ?, error_detail_json = ?,
               version_id = COALESCE(?, version_id), finished_at = ?,
               lease_owner = NULL, lease_until = NULL
             WHERE id = ? AND state = 'running' AND lease_owner = ?`,
          )
          .run(
            input.nextState,
            input.phase,
            progressJson(input.progress),
            input.errorClass ?? null,
            input.errorCode ?? null,
            input.errorDetail ? boundedJson(input.errorDetail) : null,
            input.versionId ?? null,
            input.nowMs,
            input.jobId,
            input.leaseOwner,
          );
        if (result.changes !== 1) throw new Error("JOB_LEASE_NOT_OWNED");
        if (input.nextState !== "succeeded") {
          this.terminalizeDraftCandidate(
            current,
            input.nextState === "canceled"
              ? "canceled"
              : input.nextState === "interrupted"
                ? "interrupted"
                : "failed",
            input.errorCode ?? "JOB_FAILED",
            input.nowMs,
          );
        }
        return this.getRequired(input.jobId);
      })
      .immediate();
  }

  interruptExpired(input: {
    readonly nowMs: number;
    readonly onInterrupted?: (job: JobRecord) => void;
  }): readonly JobRecord[] {
    return this.database
      .transaction(() => {
        const rows = this.database
          .prepare(
            `SELECT id FROM jobs
           WHERE state = 'running' AND lease_until < ?
           ORDER BY id`,
          )
          .all(input.nowMs) as { id: string }[];
        const update = this.database.prepare(
          `UPDATE jobs SET state = 'interrupted', phase = 'interrupted',
         error_class = 'infrastructure', error_code = 'JOB_LEASE_EXPIRED',
         finished_at = ?, lease_owner = NULL, lease_until = NULL
         WHERE id = ? AND state = 'running' AND lease_until < ?`,
        );
        const interrupted: JobRecord[] = [];
        for (const row of rows) {
          if (update.run(input.nowMs, row.id, input.nowMs).changes === 1) {
            const job = this.getRequired(row.id);
            this.terminalizeDraftCandidate(
              job,
              "interrupted",
              "JOB_LEASE_EXPIRED",
              input.nowMs,
            );
            input.onInterrupted?.(job);
            interrupted.push(job);
          }
        }
        return interrupted;
      })
      .immediate();
  }

  listPendingAutomaticRetries(): readonly JobRecord[] {
    const rows = this.database
      .prepare(
        `SELECT jobs.* FROM jobs
         WHERE jobs.state = 'interrupted'
           AND jobs.error_class = 'infrastructure'
           AND jobs.error_code IN ('JOB_LEASE_EXPIRED', 'WORKER_SHUTDOWN')
           AND jobs.automatic_retry_count = 0
           AND jobs.cancellation_requested_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM jobs AS retry
             WHERE retry.retry_of_job_id = jobs.id
           )
         ORDER BY jobs.finished_at, jobs.id`,
      )
      .all() as JobRow[];
    return Object.freeze(rows.map(mapJob));
  }

  fail(
    id: string,
    input: {
      readonly errorClass: JobErrorClass;
      readonly errorCode: string;
      readonly nowMs: number;
    },
  ): JobRecord {
    validateSafeCode(input.errorCode);
    const current = this.getRequired(id);
    if (current.state === "queued") {
      return this.database
        .transaction(() => {
          const result = this.database
            .prepare(
              `UPDATE jobs SET state = 'failed', phase = 'failed',
               error_class = ?, error_code = ?, finished_at = ?
               WHERE id = ? AND state = 'queued'`,
            )
            .run(input.errorClass, input.errorCode, input.nowMs, id);
          if (result.changes !== 1) throw new Error("JOB_TRANSITION_RACE");
          this.terminalizeDraftCandidate(
            current,
            "failed",
            input.errorCode,
            input.nowMs,
          );
          return this.getRequired(id);
        })
        .immediate();
    }
    if (!current.leaseOwner) throw new Error("JOB_LEASE_NOT_OWNED");
    return this.completeFailure({
      ...input,
      jobId: id,
      leaseOwner: current.leaseOwner,
    });
  }

  retry(
    id: string,
    input: {
      readonly automatic: boolean;
      readonly idempotency?: {
        readonly key: string;
        readonly operation: string;
      };
      readonly nowMs: number;
    },
  ): JobRecord {
    return this.database
      .transaction(() => {
        const original = this.getRequired(id);
        if (
          original.state === "succeeded" ||
          !isTerminalJobState(original.state)
        ) {
          throw new Error("JOB_NOT_RETRYABLE");
        }
        if (original.errorCode === "JOB_SUBJECT_DELETED") {
          throw new Error("JOB_SUBJECT_DELETED");
        }
        const automaticRetryCount =
          original.automaticRetryCount + (input.automatic ? 1 : 0);
        if (automaticRetryCount > 1) {
          throw new Error("AUTOMATIC_RETRY_LIMIT_EXCEEDED");
        }

        const operation = input.idempotency?.operation;
        const keySha256 = input.idempotency
          ? idempotencyHash(input.idempotency.key)
          : null;
        if (operation) validateOperation(operation);
        if (operation && keySha256) {
          const existing = this.database
            .prepare(
              `SELECT jobs.* FROM job_idempotency_keys
             JOIN jobs ON jobs.id = job_idempotency_keys.job_id
             WHERE operation = ? AND key_sha256 = ?`,
            )
            .get(operation, keySha256) as JobRow | undefined;
          if (existing) return mapJob(existing);
        }

        const retryId = createOpaqueId("job");
        if (original.kind === "build_candidate") {
          if (
            original.bookId === null ||
            original.candidateId === null ||
            original.capturedSourceId === null ||
            original.capturedConfigRevision === null
          ) {
            throw new Error("CANDIDATE_RETRY_INPUT_INVALID");
          }
          const capture = this.database
            .prepare(
              `SELECT candidate.state, books.current_candidate_id,
                      books.current_version_id, books.draft_source_id,
                      books.draft_config_revision
               FROM draft_candidates AS candidate
               JOIN books ON books.id = candidate.book_id
               WHERE candidate.id = ? AND candidate.job_id = ?
                 AND candidate.book_id = ?
                 AND books.deletion_requested_at IS NULL`,
            )
            .get(original.candidateId, original.id, original.bookId) as
            | {
                current_candidate_id: string | null;
                current_version_id: string | null;
                draft_config_revision: number | null;
                draft_source_id: string | null;
                state: string;
              }
            | undefined;
          if (
            !capture ||
            !["failed", "canceled", "interrupted"].includes(capture.state) ||
            capture.current_candidate_id !== original.candidateId ||
            capture.draft_source_id !== original.capturedSourceId ||
            capture.draft_config_revision !== original.capturedConfigRevision
          ) {
            throw new Error("CANDIDATE_RETRY_STALE");
          }
          const candidateId = createOpaqueId("draftCandidate");
          const versionId = createOpaqueId("version");
          this.database
            .prepare(
              `INSERT INTO jobs (
                id, kind, state, import_id, book_id, candidate_id, version_id,
                captured_source_id, captured_config_revision,
                captured_current_version_id, retry_of_job_id, attempt,
                automatic_retry_count, phase, progress_json, created_at
              ) VALUES (
                ?, 'build_candidate', 'queued', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?,
                'queued', ?, ?
              )`,
            )
            .run(
              retryId,
              original.importId,
              original.bookId,
              versionId,
              original.capturedSourceId,
              original.capturedConfigRevision,
              capture.current_version_id,
              original.id,
              original.attempt + 1,
              automaticRetryCount,
              progressJson(initialProgress),
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
              original.bookId,
              original.capturedSourceId,
              original.capturedConfigRevision,
              retryId,
              input.nowMs,
            );
          this.database
            .prepare("UPDATE jobs SET candidate_id = ? WHERE id = ?")
            .run(candidateId, retryId);
          const current = this.database
            .prepare(
              `UPDATE books SET current_candidate_id = ?, updated_at = ?
               WHERE id = ? AND current_candidate_id = ?
                 AND draft_source_id = ? AND draft_config_revision = ?
                 AND deletion_requested_at IS NULL`,
            )
            .run(
              candidateId,
              input.nowMs,
              original.bookId,
              original.candidateId,
              original.capturedSourceId,
              original.capturedConfigRevision,
            );
          if (current.changes !== 1) throw new Error("CANDIDATE_RETRY_STALE");
        } else {
          this.database
            .prepare(
              `INSERT INTO jobs (
                id, kind, state, import_id, book_id, candidate_id, version_id,
                captured_source_id, captured_config_revision,
                captured_current_version_id, retry_of_job_id, attempt,
                automatic_retry_count, phase, progress_json, created_at
              ) VALUES (
                ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?
              )`,
            )
            .run(
              retryId,
              original.kind,
              original.importId,
              original.bookId,
              original.candidateId,
              original.versionId,
              original.capturedSourceId,
              original.capturedConfigRevision,
              original.capturedCurrentVersionId,
              original.id,
              original.attempt + 1,
              automaticRetryCount,
              progressJson(initialProgress),
              input.nowMs,
            );
        }
        if (operation && keySha256) {
          this.database
            .prepare(
              `INSERT INTO job_idempotency_keys
              (operation, key_sha256, job_id, created_at)
             VALUES (?, ?, ?, ?)`,
            )
            .run(operation, keySha256, retryId, input.nowMs);
        }
        return this.getRequired(retryId);
      })
      .immediate();
  }
}
