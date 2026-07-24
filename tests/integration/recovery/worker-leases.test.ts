import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  JobRepository,
  createJobRepositorySchema,
} from "@/db/repositories/jobs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function workerConnections(): Promise<
  readonly [Database.Database, Database.Database]
> {
  const root = await mkdtemp(join(tmpdir(), "mirawind-worker-leases-"));
  temporaryRoots.push(root);
  const path = join(root, "jobs.sqlite");
  const first = new Database(path);
  first.pragma("journal_mode = WAL");
  createJobRepositorySchema(first);
  const second = new Database(path);
  second.pragma("journal_mode = WAL");
  return [first, second];
}

describe("two real worker connections sharing one SQLite queue", () => {
  it("enforces one global running job across claim, heartbeat and expiry", async () => {
    const [firstDatabase, secondDatabase] = await workerConnections();
    const firstWorker = new JobRepository(firstDatabase);
    const secondWorker = new JobRepository(secondDatabase);
    const firstJob = firstWorker.create({
      kind: "build_preview",
      nowMs: 1_000,
    });
    const secondJob = firstWorker.create({
      kind: "build_publish",
      nowMs: 2_000,
    });

    const claimed = firstWorker.claimNext({
      leaseOwner: "worker-a",
      nowMs: 3_000,
    });
    expect(claimed).toMatchObject({
      id: firstJob.id,
      leaseUntilMs: 63_000,
      state: "running",
    });
    expect(
      secondWorker.claimNext({ leaseOwner: "worker-b", nowMs: 3_000 }),
    ).toBeNull();
    expect(() =>
      secondWorker.heartbeat({
        jobId: firstJob.id,
        leaseOwner: "worker-b",
        nowMs: 13_000,
      }),
    ).toThrow("JOB_LEASE_NOT_OWNED");

    expect(
      firstWorker.heartbeat({
        jobId: firstJob.id,
        leaseOwner: "worker-a",
        nowMs: 13_000,
        phase: "rendering",
        progress: { completed: 12, total: 40 },
      }),
    ).toMatchObject({
      heartbeatAtMs: 13_000,
      leaseUntilMs: 73_000,
      phase: "rendering",
      progress: { completed: 12, total: 40 },
    });
    expect(secondWorker.interruptExpired({ nowMs: 73_000 })).toEqual([]);
    expect(secondWorker.interruptExpired({ nowMs: 73_001 })).toEqual([
      expect.objectContaining({
        errorClass: "infrastructure",
        errorCode: "JOB_LEASE_EXPIRED",
        id: firstJob.id,
        state: "interrupted",
      }),
    ]);

    expect(
      secondWorker.claimNext({ leaseOwner: "worker-b", nowMs: 73_002 }),
    ).toMatchObject({
      id: secondJob.id,
      state: "running",
    });
    firstDatabase.close();
    secondDatabase.close();
  });
});
