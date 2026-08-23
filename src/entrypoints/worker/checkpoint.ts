import { stat } from "node:fs/promises";
import type Database from "better-sqlite3";

import type { StorageLayout } from "@/platform/filesystem/layout";

export const passiveCheckpointIntervalMs = 60_000;
export const walSizeWarningBytes = 256 * 1024 * 1024;

export interface WorkerStorageHealth {
  readonly checkpoint: {
    readonly busy: number;
    readonly checkpointedPages: number;
    readonly logPages: number;
    readonly mode: "PASSIVE";
  };
  readonly checkedAt: string;
  readonly lease: {
    readonly activeJobs: number;
    readonly earliestExpiry: string | null;
  };
  readonly status: "healthy" | "warning";
  readonly walBytes: number;
  readonly warnings: readonly string[];
}

interface CheckpointRow {
  busy: number;
  checkpointed: number;
  log: number;
}

async function fileSize(path: string): Promise<number> {
  return stat(path)
    .then((metadata) => metadata.size)
    .catch((error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return 0;
      }
      throw error;
    });
}

function leaseHealth(database: Database.Database): {
  readonly activeJobs: number;
  readonly earliestExpiry: string | null;
} {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS active_jobs, MIN(lease_until) AS earliest_expiry
       FROM jobs WHERE state = 'running'`,
    )
    .get() as { active_jobs: number; earliest_expiry: number | null };
  return Object.freeze({
    activeJobs: row.active_jobs,
    earliestExpiry:
      row.earliest_expiry === null
        ? null
        : new Date(row.earliest_expiry).toISOString(),
  });
}

export async function runPassiveCheckpoint(input: {
  readonly database: Database.Database;
  readonly databasePath: string;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<WorkerStorageHealth> {
  const row = (
    input.database.pragma("wal_checkpoint(PASSIVE)") as CheckpointRow[]
  )[0];
  if (!row) throw new Error("WAL_CHECKPOINT_RESULT_MISSING");
  const walBytes = await fileSize(`${input.databasePath}-wal`);
  const warnings: string[] = [];
  if (row.busy > 0) warnings.push("WAL_CHECKPOINT_BUSY");
  if (walBytes >= walSizeWarningBytes) warnings.push("WAL_SIZE_HIGH");
  const status = Object.freeze({
    checkpoint: Object.freeze({
      busy: row.busy,
      checkpointedPages: row.checkpointed,
      logPages: row.log,
      mode: "PASSIVE" as const,
    }),
    checkedAt: new Date(input.nowMs).toISOString(),
    lease: leaseHealth(input.database),
    status: warnings.length === 0 ? ("healthy" as const) : ("warning" as const),
    walBytes,
    warnings: Object.freeze(warnings),
  });
  return status;
}

export function runMaintenanceCheckpoint(input: {
  readonly database: Database.Database;
  readonly maintenance: true;
  readonly mode: "RESTART" | "TRUNCATE";
}): Readonly<CheckpointRow> {
  if (input.maintenance !== true) {
    throw new Error("WAL_MAINTENANCE_CONFIRMATION_REQUIRED");
  }
  const row = (
    input.database.pragma(`wal_checkpoint(${input.mode})`) as CheckpointRow[]
  )[0];
  if (!row) throw new Error("WAL_CHECKPOINT_RESULT_MISSING");
  return Object.freeze({ ...row });
}

export class WorkerCheckpointScheduler {
  private lastCheckpointAtMs: number | null = null;

  constructor(
    private readonly input: {
      readonly database: Database.Database;
      readonly databasePath: string;
      readonly layout: StorageLayout;
    },
  ) {}

  async checkpointIfDue(nowMs: number): Promise<WorkerStorageHealth | null> {
    if (
      this.lastCheckpointAtMs !== null &&
      nowMs - this.lastCheckpointAtMs < passiveCheckpointIntervalMs
    ) {
      return null;
    }
    const health = await runPassiveCheckpoint({ ...this.input, nowMs });
    this.lastCheckpointAtMs = nowMs;
    return health;
  }
}
