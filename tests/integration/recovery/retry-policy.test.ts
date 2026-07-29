import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  JobRepository,
  createJobRepositorySchema,
  type JobRecord,
} from "@/modules/publishing/adapters/sqlite/jobs";
import { recoverExpiredJobLeases } from "@/modules/publishing/application/recover-expired-jobs";
import { evaluateJobRetry } from "@/modules/publishing/application/retry-policy";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

function terminalJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    attempt: 1,
    automaticRetryCount: 0,
    bookId: 42,
    capturedConfigRevision: 3,
    capturedCurrentVersionId: null,
    capturedSourceId: "src_fixture",
    createdAtMs: 1_000,
    errorClass: "content",
    errorCode: "CONTENT_INVALID",
    errorDetail: null,
    finishedAtMs: 2_000,
    heartbeatAtMs: null,
    id: "job_fixture",
    importId: "imp_fixture",
    kind: "analyze_import",
    leaseOwner: null,
    leaseUntilMs: null,
    phase: "failed",
    progress: {
      completed: 0,
      processed_bytes: null,
      total: null,
      unit: "steps",
    },
    cancellationRequestedAtMs: null,
    retryOfJobId: null,
    startedAtMs: 1_100,
    state: "failed",
    versionId: null,
    ...overrides,
  };
}

describe("job retry policy", () => {
  it("allows exactly one automatic retry only for an expired infrastructure lease", () => {
    expect(
      evaluateJobRetry(
        terminalJob({
          errorClass: "infrastructure",
          errorCode: "JOB_LEASE_EXPIRED",
          state: "interrupted",
        }),
        "automatic",
      ),
    ).toEqual({ allowed: true });

    for (const job of [
      terminalJob({
        automaticRetryCount: 1,
        errorClass: "infrastructure",
        errorCode: "JOB_LEASE_EXPIRED",
        state: "interrupted",
      }),
      terminalJob({
        errorClass: "infrastructure",
        errorCode: "WORKER_EXIT",
        state: "interrupted",
      }),
      terminalJob({ errorClass: "timeout", errorCode: "JOB_TIMEOUT" }),
      terminalJob({
        errorClass: "security_limit",
        errorCode: "ARCHIVE_LIMIT",
      }),
    ]) {
      expect(evaluateJobRetry(job, "automatic").allowed).toBe(false);
    }
  });

  it("cleans expired staging and creates at most one infrastructure retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirawind-job-recovery-"));
    temporaryRoots.push(root);
    const database = new Database(join(root, "jobs.sqlite"));
    createJobRepositorySchema(database);
    const repository = new JobRepository(database);
    const original = repository.create({
      kind: "reconcile",
      nowMs: 1_000,
    });
    repository.claimNext({ leaseOwner: "worker-a", nowMs: 2_000 });
    await mkdir(join(root, "staging", original.id), { recursive: true });

    const firstRecovery = await recoverExpiredJobLeases({
      nowMs: 62_001,
      repository,
      storageRoot: root,
    });
    expect(firstRecovery).toEqual([
      expect.objectContaining({
        interrupted: expect.objectContaining({
          errorCode: "JOB_LEASE_EXPIRED",
          id: original.id,
          state: "interrupted",
        }),
        retry: expect.objectContaining({
          attempt: 2,
          automaticRetryCount: 1,
          retryOfJobId: original.id,
          state: "queued",
        }),
      }),
    ]);
    await expect(
      stat(join(root, "staging", original.id)),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const retry = firstRecovery[0]?.retry;
    if (!retry) throw new Error("Expected automatic retry");
    repository.claimNext({ leaseOwner: "worker-b", nowMs: 63_000 });
    await mkdir(join(root, "staging", retry.id), { recursive: true });
    const secondRecovery = await recoverExpiredJobLeases({
      nowMs: 123_001,
      repository,
      storageRoot: root,
    });
    expect(secondRecovery).toEqual([
      expect.objectContaining({
        interrupted: expect.objectContaining({
          automaticRetryCount: 1,
          id: retry.id,
          state: "interrupted",
        }),
        retry: null,
      }),
    ]);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM jobs").get(),
    ).toEqual({ count: 2 });
    database.close();
  });

  it.each([
    ["content", "CONTENT_INVALID"],
    ["validation", "SCHEMA_INVALID"],
    ["security_limit", "ARCHIVE_LIMIT"],
    ["timeout", "JOB_TIMEOUT"],
    ["infrastructure", "JOB_LEASE_EXPIRED"],
    ["canceled", "JOB_CANCELED"],
  ] as const)(
    "allows an administrator to retry terminal %s failures",
    (errorClass, errorCode) => {
      expect(
        evaluateJobRetry(
          terminalJob({
            automaticRetryCount: errorClass === "infrastructure" ? 1 : 0,
            errorClass,
            errorCode,
            state: errorClass === "infrastructure" ? "interrupted" : "failed",
          }),
          "manual",
        ),
      ).toEqual({ allowed: true });
    },
  );

  it("rejects nonterminal, successful, and ready publication attempts", () => {
    expect(
      evaluateJobRetry(
        terminalJob({
          errorClass: null,
          errorCode: null,
          finishedAtMs: null,
          state: "running",
        }),
        "manual",
      ),
    ).toMatchObject({ allowed: false });
    expect(
      evaluateJobRetry(
        terminalJob({
          errorClass: null,
          errorCode: null,
          state: "succeeded",
        }),
        "manual",
      ),
    ).toMatchObject({ allowed: false });
    expect(
      evaluateJobRetry(
        terminalJob({
          errorClass: "infrastructure",
          errorCode: "WORKER_EXIT",
          kind: "build_publish",
          versionId: "ver_ready",
        }),
        "manual",
      ),
    ).toMatchObject({
      allowed: false,
      reason: "READY_PUBLICATION_REQUIRES_PUBLISH_ACTION",
    });
  });
});
