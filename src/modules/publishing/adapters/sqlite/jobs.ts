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

export function createJobRepositorySchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','canceled','interrupted')),
      import_id TEXT,
      book_id INTEGER,
      version_id TEXT,
      captured_source_id TEXT,
      captured_config_revision INTEGER,
      captured_current_version_id TEXT,
      retry_of_job_id TEXT REFERENCES jobs(id),
      attempt INTEGER NOT NULL CHECK(attempt >= 1),
      automatic_retry_count INTEGER NOT NULL CHECK(automatic_retry_count BETWEEN 0 AND 1),
      lease_owner TEXT,
      lease_until INTEGER,
      heartbeat_at INTEGER,
      phase TEXT NOT NULL,
      progress_json TEXT NOT NULL DEFAULT '{"completed":0,"total":null,"unit":"steps","processed_bytes":null}',
      error_code TEXT,
      error_class TEXT,
      error_detail_json TEXT,
      cancellation_requested_at INTEGER,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS jobs_claim_order ON jobs(state, created_at, id);
    CREATE TABLE IF NOT EXISTS job_idempotency_keys (
      operation TEXT NOT NULL,
      key_sha256 TEXT NOT NULL,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (operation, key_sha256)
    ) STRICT, WITHOUT ROWID;
  `);
}

export class JobRepository {
  constructor(private readonly database: Database.Database) {}

  private hasTable(name: string): boolean {
    return (
      this.database
        .prepare(
          `SELECT 1 FROM sqlite_master
           WHERE type = 'table' AND name = ?`,
        )
        .get(name) !== undefined
    );
  }

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
            id, kind, state, import_id, book_id, version_id,
            captured_source_id, captured_config_revision,
            captured_current_version_id, attempt, automatic_retry_count,
            phase, progress_json, created_at
          ) VALUES (
            ?, ?, 'queued', ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?
          )`,
          )
          .run(
            id,
            input.kind,
            input.importId ?? null,
            input.bookId ?? null,
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
          this.markDeletionCleanupFailure(
            current,
            "CLEANUP_INTERRUPTED",
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
    this.markDeletionCleanupFailure(
      current,
      input.errorClass === "timeout"
        ? "CLEANUP_TIMEOUT"
        : input.errorClass === "infrastructure"
          ? "CLEANUP_INTERRUPTED"
          : "CLEANUP_FILESYSTEM_IO",
      input.nowMs,
    );
    return completed;
  }

  private markDeletionCleanupFailure(
    job: JobRecord,
    safeErrorCode: string,
    nowMs: number,
  ): void {
    if (
      job.kind !== "reclaim" ||
      job.bookId === null ||
      !this.hasTable("book_deletions")
    ) {
      return;
    }
    this.database
      .prepare(
        `UPDATE book_deletions
         SET state = 'failed', safe_error_code = ?, updated_at = ?
         WHERE cleanup_job_id = ? AND book_id = ?
           AND state IN ('pending', 'purging')`,
      )
      .run(safeErrorCode, nowMs, job.id, job.bookId);
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
    return this.getRequired(input.jobId);
  }

  interruptExpired(input: { readonly nowMs: number }): readonly JobRecord[] {
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
            this.markDeletionCleanupFailure(
              job,
              "CLEANUP_INTERRUPTED",
              input.nowMs,
            );
            interrupted.push(job);
          }
        }
        return interrupted;
      })
      .immediate();
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
      const result = this.database
        .prepare(
          `UPDATE jobs SET state = 'failed', phase = 'failed',
           error_class = ?, error_code = ?, finished_at = ?
           WHERE id = ? AND state = 'queued'`,
        )
        .run(input.errorClass, input.errorCode, input.nowMs, id);
      if (result.changes !== 1) throw new Error("JOB_TRANSITION_RACE");
      this.markDeletionCleanupFailure(
        current,
        input.errorClass === "timeout"
          ? "CLEANUP_TIMEOUT"
          : "CLEANUP_INTERRUPTED",
        input.nowMs,
      );
      return this.getRequired(id);
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
        const supportsBookDeletion =
          this.hasTable("books") && this.hasTable("book_deletions");
        const currentDeletionCleanup =
          supportsBookDeletion &&
          original.kind === "reclaim" &&
          this.database
            .prepare(
              `SELECT 1 FROM book_deletions
               WHERE cleanup_job_id = ? AND state != 'completed'`,
            )
            .get(original.id) !== undefined;
        const deletedSubject =
          supportsBookDeletion &&
          this.database
            .prepare(
              `SELECT 1
               FROM books
               WHERE deletion_requested_at IS NOT NULL
                 AND (
                   id = @bookId
                   OR id = (
                     SELECT book_id FROM imports WHERE id = @importId
                   )
                   OR id = (
                     SELECT book_id FROM source_snapshots
                     WHERE id = @sourceId
                   )
                   OR id = (
                     SELECT book_id FROM book_versions WHERE id = @versionId
                   )
                 )
               LIMIT 1`,
            )
            .get({
              bookId: original.bookId,
              importId: original.importId,
              sourceId: original.capturedSourceId,
              versionId:
                original.versionId ?? original.capturedCurrentVersionId,
            }) !== undefined;
        if (deletedSubject && !currentDeletionCleanup) {
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
        this.database
          .prepare(
            `INSERT INTO jobs (
            id, kind, state, import_id, book_id, version_id,
            captured_source_id, captured_config_revision,
            captured_current_version_id, retry_of_job_id, attempt,
            automatic_retry_count, phase, progress_json, created_at
          ) VALUES (
            ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', '{}', ?
          )`,
          )
          .run(
            retryId,
            original.kind,
            original.importId,
            original.bookId,
            original.versionId,
            original.capturedSourceId,
            original.capturedConfigRevision,
            original.capturedCurrentVersionId,
            original.id,
            original.attempt + 1,
            automaticRetryCount,
            input.nowMs,
          );
        if (
          supportsBookDeletion &&
          original.kind === "reclaim" &&
          original.bookId !== null
        ) {
          this.database
            .prepare(
              `UPDATE book_deletions
               SET cleanup_job_id = ?, state = 'pending',
                   safe_error_code = NULL, completed_at = NULL,
                   updated_at = ?
               WHERE cleanup_job_id = ? AND book_id = ?
                 AND state != 'completed'`,
            )
            .run(retryId, input.nowMs, original.id, original.bookId);
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
