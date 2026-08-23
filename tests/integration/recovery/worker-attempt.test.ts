import { describe, expect, it } from "vitest";

import {
  completeJobFailure,
  completeJobInterruption,
} from "@/composition/worker/attempt-lifecycle";
import { completeWorkerAttempt } from "@/composition/worker/complete-attempt";
import { executeWorkerAttempt } from "@/composition/worker/execute-attempt";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { withMigratedTestDatabase } from "../../helpers/database";

describe("worker attempt terminal coordinator", () => {
  it("keeps child execution non-terminal until the completion coordinator runs", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const jobs = new JobRepository(database);
      const candidates = new DraftCandidateRepository(database);
      const job = jobs.create({ kind: "reconcile", nowMs: 1_000 });
      const claimed = jobs.claimNext({
        leaseOwner: "worker-a",
        nowMs: 2_000,
      });
      if (!claimed) throw new Error("EXPECTED_CLAIMED_JOB");
      const outcome = await executeWorkerAttempt({
        candidates,
        childRunner: async (command) => ({
          exitCode: 0,
          memory: {
            failedSamples: 0,
            peakProcessTreeRssBytes: 4_096,
            sampleIntervalMs: 250,
            samples: 1,
            status: "available",
          },
          result: {
            jobId: command.jobId,
            ok: true,
            protocolVersion: 4,
            result: {},
            type: "result",
          },
          signal: null,
        }),
        database,
        drafts: new DraftRepository(database),
        imports: new ImportRepository(database),
        job: claimed,
        layout: dataRoot.layout,
        leaseOwner: "worker-a",
        repository: jobs,
        shutdownSignal: new AbortController().signal,
        sources: new SourceRepository(database),
      });
      expect(outcome).toMatchObject({
        execution: { result: { ok: true } },
        kind: "child_closed",
      });
      expect(jobs.get(job.id)?.state).toBe("running");

      await completeWorkerAttempt({
        candidates,
        database,
        imports: new ImportRepository(database),
        job: claimed,
        layout: dataRoot.layout,
        leaseOwner: "worker-a",
        outcome,
        repository: jobs,
      });
      expect(jobs.get(job.id)?.state).toBe("succeeded");
    }));

  it.each([
    ["content", "ARCHIVE_INVALID", "failed"],
    ["canceled", "JOB_CANCELED", "canceled"],
    ["timeout", "JOB_TIMEOUT", "failed"],
  ] as const)(
    "records %s failure exactly once",
    (errorClass, errorCode, state) =>
      withMigratedTestDatabase(async ({ database }) => {
        const jobs = new JobRepository(database);
        const candidates = new DraftCandidateRepository(database);
        const job = jobs.create({ kind: "reconcile", nowMs: 1_000 });
        jobs.claimNext({ leaseOwner: "worker-a", nowMs: 2_000 });
        expect(
          completeJobFailure({
            candidates,
            database,
            errorClass,
            errorCode,
            job,
            leaseOwner: "worker-a",
            nowMs: 3_000,
            repository: jobs,
          }),
        ).toMatchObject({ errorClass, errorCode, state });
        expect(() =>
          completeJobFailure({
            candidates,
            database,
            errorClass,
            errorCode,
            job,
            leaseOwner: "worker-a",
            nowMs: 4_000,
            repository: jobs,
          }),
        ).toThrow();
      }),
  );

  it("records interruption exactly once", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const jobs = new JobRepository(database);
      const candidates = new DraftCandidateRepository(database);
      const job = jobs.create({ kind: "reconcile", nowMs: 1_000 });
      jobs.claimNext({ leaseOwner: "worker-a", nowMs: 2_000 });
      expect(
        completeJobInterruption({
          candidates,
          database,
          errorCode: "WORKER_SHUTDOWN",
          job,
          leaseOwner: "worker-a",
          nowMs: 3_000,
          repository: jobs,
        }),
      ).toMatchObject({ errorCode: "WORKER_SHUTDOWN", state: "interrupted" });
      expect(() =>
        completeJobInterruption({
          candidates,
          database,
          errorCode: "WORKER_SHUTDOWN",
          job,
          leaseOwner: "worker-a",
          nowMs: 4_000,
          repository: jobs,
        }),
      ).toThrow();
    }));

  it("records generic success exactly once", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const jobs = new JobRepository(database);
      const job = jobs.create({ kind: "reconcile", nowMs: 1_000 });
      jobs.claimNext({ leaseOwner: "worker-a", nowMs: 2_000 });
      expect(
        jobs.completeSuccess({
          jobId: job.id,
          leaseOwner: "worker-a",
          nowMs: 3_000,
        }),
      ).toMatchObject({ state: "succeeded" });
      expect(() =>
        jobs.completeSuccess({
          jobId: job.id,
          leaseOwner: "worker-a",
          nowMs: 4_000,
        }),
      ).toThrow();
    }));
});
