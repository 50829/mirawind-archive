import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import { createOpaqueId } from "../../domain/ids.js";
import {
  assertJobTransition,
  isTerminalJobState,
  type JobState,
  type TerminalJobState,
} from "../../jobs/state-machine.js";

export const jobKinds = [
  "analyze_import",
  "prepare_draft",
  "build_preview",
  "build_publish",
  "verify_version",
  "reconcile",
  "reclaim",
] as const;

export type JobKind = (typeof jobKinds)[number];
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
  requested_cancel_at: number | null;
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
  readonly progress: Readonly<Record<string, unknown>>;
  readonly requestedCancelAtMs: number | null;
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
    progress: parseBoundedObject(row.progress_json) ?? {},
    requestedCancelAtMs: row.requested_cancel_at,
    retryOfJobId: row.retry_of_job_id,
    startedAtMs: row.started_at,
    state: row.state,
    versionId: row.version_id,
  };
}

function boundedJson(value: Readonly<Record<string, unknown>>): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > 65_536) {
    throw new Error("JOB_JSON_TOO_LARGE");
  }
  return json;
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
      progress_json TEXT NOT NULL DEFAULT '{}',
      error_code TEXT,
      error_class TEXT,
      error_detail_json TEXT,
      requested_cancel_at INTEGER,
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
        this.database
          .prepare(
            `INSERT INTO jobs (
            id, kind, state, import_id, book_id, version_id,
            captured_source_id, captured_config_revision,
            captured_current_version_id, attempt, automatic_retry_count,
            phase, progress_json, created_at
          ) VALUES (
            ?, ?, 'queued', ?, ?, ?, ?, ?, ?, 1, 0, ?, '{}', ?
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
            input.phase ?? "queued",
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
    readonly progress?: Readonly<Record<string, unknown>>;
  }): JobRecord {
    const progress = input.progress ? boundedJson(input.progress) : null;
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
              `UPDATE jobs SET state = 'canceled', requested_cancel_at = ?,
             finished_at = ?, error_class = 'canceled',
             error_code = 'JOB_CANCELED', phase = 'canceled'
             WHERE id = ? AND state = 'queued'`,
            )
            .run(nowMs, nowMs, id);
        } else {
          this.database
            .prepare(
              `UPDATE jobs SET requested_cancel_at = ?
             WHERE id = ? AND state = 'running'
               AND requested_cancel_at IS NULL`,
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
    readonly progress?: Readonly<Record<string, unknown>>;
    readonly versionId?: string;
  }): JobRecord {
    return this.completeOwned({
      ...input,
      nextState: "succeeded",
      phase: "complete",
      progress: input.progress ?? {},
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
    return this.completeOwned({
      ...input,
      errorDetail: input.errorDetail ?? {},
      nextState,
      phase: nextState,
      progress: {},
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
    readonly progress: Readonly<Record<string, unknown>>;
    readonly versionId?: string;
  }): JobRecord {
    const current = this.getRequired(input.jobId);
    assertJobTransition(current.state, input.nextState);
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
        boundedJson(input.progress),
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
            interrupted.push(this.getRequired(row.id));
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
