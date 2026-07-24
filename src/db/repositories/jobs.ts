import type Database from "better-sqlite3";

import { createOpaqueId } from "../../domain/ids.js";

type JobState =
  "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";

interface JobRow {
  attempt: number;
  automatic_retry_count: number;
  error_class: string | null;
  error_code: string | null;
  finished_at: number | null;
  heartbeat_at: number | null;
  id: string;
  kind: string;
  lease_owner: string | null;
  lease_until: number | null;
  retry_of_job_id: string | null;
  state: JobState;
}

export interface JobRecord {
  readonly attempt: number;
  readonly automaticRetryCount: number;
  readonly errorClass: string | null;
  readonly errorCode: string | null;
  readonly finishedAtMs: number | null;
  readonly heartbeatAtMs: number | null;
  readonly id: string;
  readonly kind: string;
  readonly leaseOwner: string | null;
  readonly leaseUntilMs: number | null;
  readonly retryOfJobId: string | null;
  readonly state: JobState;
}

function mapJob(row: JobRow): JobRecord {
  return {
    attempt: row.attempt,
    automaticRetryCount: row.automatic_retry_count,
    errorClass: row.error_class,
    errorCode: row.error_code,
    finishedAtMs: row.finished_at,
    heartbeatAtMs: row.heartbeat_at,
    id: row.id,
    kind: row.kind,
    leaseOwner: row.lease_owner,
    leaseUntilMs: row.lease_until,
    retryOfJobId: row.retry_of_job_id,
    state: row.state,
  };
}

export function createJobRepositorySchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','canceled','interrupted')),
      attempt INTEGER NOT NULL CHECK(attempt >= 1),
      automatic_retry_count INTEGER NOT NULL CHECK(automatic_retry_count BETWEEN 0 AND 1),
      retry_of_job_id TEXT REFERENCES jobs(id),
      lease_owner TEXT,
      lease_until INTEGER,
      heartbeat_at INTEGER,
      error_code TEXT,
      error_class TEXT,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS jobs_claim_order ON jobs(state, created_at, id);
  `);
}

export class JobRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: { readonly kind: string; readonly nowMs?: number }): JobRecord {
    const id = createOpaqueId("job");
    this.database
      .prepare(
        `INSERT INTO jobs
          (id, kind, state, attempt, automatic_retry_count, created_at)
         VALUES (?, ?, 'queued', 1, 0, ?)`,
      )
      .run(id, input.kind, input.nowMs ?? Date.now());
    return this.getRequired(id);
  }

  get(id: string): JobRecord | null {
    const row = this.database
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(id) as JobRow | undefined;
    return row ? mapJob(row) : null;
  }

  private getRequired(id: string): JobRecord {
    const job = this.get(id);
    if (!job) throw new Error("Job does not exist");
    return job;
  }

  claimNext(input: {
    readonly leaseOwner: string;
    readonly nowMs: number;
  }): JobRecord | null {
    const claim = this.database.transaction(() => {
      const active = this.database
        .prepare("SELECT 1 FROM jobs WHERE state = 'running' LIMIT 1")
        .get();
      if (active) return null;
      const candidate = this.database
        .prepare(
          "SELECT id FROM jobs WHERE state = 'queued' ORDER BY created_at, id LIMIT 1",
        )
        .get() as { id: string } | undefined;
      if (!candidate) return null;
      const result = this.database
        .prepare(
          `UPDATE jobs
           SET state = 'running', lease_owner = ?, heartbeat_at = ?, lease_until = ?
           WHERE id = ? AND state = 'queued'`,
        )
        .run(input.leaseOwner, input.nowMs, input.nowMs + 60_000, candidate.id);
      return result.changes === 1 ? this.getRequired(candidate.id) : null;
    });
    return claim.immediate();
  }

  heartbeat(input: {
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly nowMs: number;
  }): JobRecord {
    const result = this.database
      .prepare(
        `UPDATE jobs SET heartbeat_at = ?, lease_until = ?
         WHERE id = ? AND state = 'running' AND lease_owner = ?`,
      )
      .run(input.nowMs, input.nowMs + 60_000, input.jobId, input.leaseOwner);
    if (result.changes !== 1) throw new Error("Job lease is not owned");
    return this.getRequired(input.jobId);
  }

  interruptExpired(input: { readonly nowMs: number }): readonly JobRecord[] {
    const rows = this.database
      .prepare(
        "SELECT id FROM jobs WHERE state = 'running' AND lease_until < ? ORDER BY id",
      )
      .all(input.nowMs) as { id: string }[];
    const update = this.database.prepare(
      `UPDATE jobs SET state = 'interrupted', finished_at = ?,
       lease_owner = NULL, lease_until = NULL WHERE id = ? AND state = 'running'`,
    );
    const interrupt = this.database.transaction(() => {
      for (const row of rows) update.run(input.nowMs, row.id);
    });
    interrupt.immediate();
    return rows.map((row) => this.getRequired(row.id));
  }

  fail(
    id: string,
    input: {
      readonly errorClass: string;
      readonly errorCode: string;
      readonly nowMs: number;
    },
  ): JobRecord {
    const result = this.database
      .prepare(
        `UPDATE jobs SET state = 'failed', error_class = ?, error_code = ?,
         finished_at = ?, lease_owner = NULL, lease_until = NULL
         WHERE id = ? AND state IN ('queued', 'running')`,
      )
      .run(input.errorClass, input.errorCode, input.nowMs, id);
    if (result.changes !== 1)
      throw new Error("Job cannot transition to failed");
    return this.getRequired(id);
  }

  retry(
    id: string,
    input: { readonly automatic: boolean; readonly nowMs: number },
  ): JobRecord {
    const original = this.getRequired(id);
    if (!["failed", "interrupted", "canceled"].includes(original.state)) {
      throw new Error("Only terminal unsuccessful jobs can be retried");
    }
    const automaticRetryCount =
      original.automaticRetryCount + (input.automatic ? 1 : 0);
    if (automaticRetryCount > 1)
      throw new Error("Automatic retry limit exceeded");
    const retryId = createOpaqueId("job");
    this.database
      .prepare(
        `INSERT INTO jobs
          (id, kind, state, attempt, automatic_retry_count, retry_of_job_id, created_at)
         VALUES (?, ?, 'queued', ?, ?, ?, ?)`,
      )
      .run(
        retryId,
        original.kind,
        original.attempt + 1,
        automaticRetryCount,
        original.id,
        input.nowMs,
      );
    return this.getRequired(retryId);
  }
}
