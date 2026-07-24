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
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function connections(): Promise<[Database.Database, Database.Database]> {
  const root = await mkdtemp(join(tmpdir(), "mirawind-jobs-"));
  temporaryRoots.push(root);
  const path = join(root, "jobs.sqlite");
  const first = new Database(path);
  first.pragma("journal_mode = WAL");
  createJobRepositorySchema(first);
  return [first, new Database(path)];
}

describe("durable job repository", () => {
  it("allows only one claimant to atomically acquire a queued job", async () => {
    const [firstDatabase, secondDatabase] = await connections();
    const first = new JobRepository(firstDatabase);
    const second = new JobRepository(secondDatabase);
    const job = first.create({ kind: "analyze_import" });

    const claimed = [
      first.claimNext({ leaseOwner: "worker-a", nowMs: 1_000 }),
      second.claimNext({ leaseOwner: "worker-b", nowMs: 1_000 }),
    ].filter(Boolean);

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(job.id);
    firstDatabase.close();
    secondDatabase.close();
  });

  it("uses a 10-second heartbeat and expires a lease after 60 seconds", async () => {
    const [database, secondDatabase] = await connections();
    const repository = new JobRepository(database);
    repository.create({ kind: "build_preview" });
    const claimed = repository.claimNext({
      leaseOwner: "worker-a",
      nowMs: 1_000,
    });
    expect(claimed?.leaseUntilMs).toBe(61_000);
    if (!claimed) throw new Error("Expected the queued job to be claimed");

    expect(
      repository.heartbeat({
        jobId: claimed.id,
        leaseOwner: "worker-a",
        nowMs: 11_000,
      }).leaseUntilMs,
    ).toBe(71_000);
    expect(repository.interruptExpired({ nowMs: 71_001 })).toHaveLength(1);
    database.close();
    secondDatabase.close();
  });

  it("creates an immutable retry attempt instead of overwriting history", async () => {
    const [database, secondDatabase] = await connections();
    const repository = new JobRepository(database);
    const original = repository.create({ kind: "build_publish" });
    repository.fail(original.id, {
      errorClass: "infrastructure",
      errorCode: "WORKER_EXIT",
      nowMs: 2_000,
    });

    const retry = repository.retry(original.id, {
      automatic: true,
      nowMs: 3_000,
    });
    expect(retry).toMatchObject({
      attempt: 2,
      automaticRetryCount: 1,
      retryOfJobId: original.id,
      state: "queued",
    });
    expect(repository.get(original.id)).toMatchObject({
      state: "failed",
      attempt: 1,
    });
    database.close();
    secondDatabase.close();
  });
});
