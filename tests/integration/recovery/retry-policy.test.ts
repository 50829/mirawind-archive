import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  JobRepository,
  type JobRecord,
} from "@/modules/publishing/adapters/sqlite/jobs";
import {
  retryCandidateBuild,
  terminalizeCandidateBuild,
} from "@/modules/publishing/application/commands/maintain-candidate-build";
import { recoverExpiredJobLeases } from "@/modules/publishing/application/recover-expired-jobs";
import { evaluateJobRetry } from "@/modules/publishing/application/retry-policy";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import { withMigratedTestDatabase } from "../../helpers/database";
import { setupPublicationFixture } from "../../helpers/publication";

function terminalJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    attempt: 1,
    automaticRetryCount: 0,
    bookId: 42,
    candidateId: null,
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
    await withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const repository = new JobRepository(database);
      const original = repository.create({
        kind: "reconcile",
        nowMs: 1_000,
      });
      repository.claimNext({ leaseOwner: "worker-a", nowMs: 2_000 });
      await mkdir(join(dataRoot.path, "staging", original.id), {
        recursive: true,
      });

      expect(repository.interruptExpired({ nowMs: 62_001 })).toHaveLength(1);
      const firstRecovery = await recoverExpiredJobLeases({
        nowMs: 62_001,
        repository,
        retryJob: (job, nowMs) =>
          repository.retry(job.id, { automatic: true, nowMs }),
        storageRoot: dataRoot.path,
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
        stat(join(dataRoot.path, "staging", original.id)),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const retry = firstRecovery[0]?.retry;
      if (!retry) throw new Error("Expected automatic retry");
      repository.claimNext({ leaseOwner: "worker-b", nowMs: 63_000 });
      await mkdir(join(dataRoot.path, "staging", retry.id), {
        recursive: true,
      });
      const secondRecovery = await recoverExpiredJobLeases({
        nowMs: 123_001,
        repository,
        retryJob: (job, nowMs) =>
          repository.retry(job.id, { automatic: true, nowMs }),
        storageRoot: dataRoot.path,
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
    });
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

  it("rejects nonterminal and successful attempts", () => {
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
  });

  it("retries a failed candidate with new job, candidate, and version identities", () =>
    withMigratedTestDatabase(({ database }) => {
      const fixture = setupPublicationFixture(database, {
        registerReady: false,
      });
      fixture.jobs.heartbeat({
        jobId: fixture.candidateJob.id,
        leaseOwner: "worker:test",
        nowMs: 7,
        phase: "render_pages",
        progress: {
          completed: 12,
          processed_bytes: 4_096,
          total: 30,
          unit: "pages",
        },
      });
      const failed = withImmediateTransaction(database, () => {
        const completed = fixture.jobs.completeFailure({
          errorClass: "timeout",
          errorCode: "JOB_TIMEOUT",
          jobId: fixture.candidateJob.id,
          leaseOwner: "worker:test",
          nowMs: 8,
        });
        terminalizeCandidateBuild({
          candidates: fixture.candidates,
          job: completed,
          nowMs: 8,
          safeErrorCode: "JOB_TIMEOUT",
          state: "failed",
        });
        return completed;
      });
      const originalCandidate = fixture.candidates.require(
        fixture.candidate.attemptId,
      );

      const retry = retryCandidateBuild({
        automatic: false,
        candidates: fixture.candidates,
        job: failed,
        jobs: fixture.jobs,
        nowMs: 9,
        runAtomically: (operation) =>
          withImmediateTransaction(database, operation),
      });
      if (!retry.candidateId || !retry.versionId) {
        throw new Error("CANDIDATE_RETRY_IDENTITIES_MISSING");
      }
      const retryCandidate = fixture.candidates.require(retry.candidateId);

      expect(failed).toMatchObject({
        progress: {
          completed: 12,
          processed_bytes: 4_096,
          total: 30,
          unit: "pages",
        },
        state: "failed",
        versionId: fixture.candidateJob.versionId,
      });
      expect(originalCandidate).toMatchObject({
        attemptId: fixture.candidate.attemptId,
        safeErrorCode: "JOB_TIMEOUT",
        state: "failed",
        versionId: null,
      });
      expect(retry).toMatchObject({
        attempt: 2,
        candidateId: retryCandidate.attemptId,
        retryOfJobId: failed.id,
        state: "queued",
      });
      expect(retry.id).not.toBe(failed.id);
      expect(retry.candidateId).not.toBe(failed.candidateId);
      expect(retry.versionId).not.toBe(failed.versionId);
      expect(retryCandidate).toMatchObject({
        jobId: retry.id,
        state: "building",
        versionId: null,
      });
      expect(
        fixture.drafts.requireBook(fixture.book.id).currentCandidateId,
      ).toBe(retry.candidateId);
      expect(fixture.candidates.buildCommand(retry.candidateId)).toMatchObject({
        candidateId: retry.candidateId,
        jobId: retry.id,
        versionId: retry.versionId,
      });
      const canceled = withImmediateTransaction(database, () => {
        const completed = fixture.jobs.requestCancellation(retry.id, 10);
        terminalizeCandidateBuild({
          candidates: fixture.candidates,
          job: completed,
          nowMs: 10,
          safeErrorCode: "JOB_CANCELED",
          state: "canceled",
        });
        return completed;
      });
      expect(canceled).toMatchObject({
        cancellationRequestedAtMs: 10,
        errorCode: "JOB_CANCELED",
        state: "canceled",
      });
      expect(fixture.candidates.require(retry.candidateId)).toMatchObject({
        safeErrorCode: "JOB_CANCELED",
        state: "canceled",
      });
    }));

  it("terminalizes an expired candidate before creating its one automatic retry", async () => {
    await withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const fixture = setupPublicationFixture(database, {
        registerReady: false,
      });
      fixture.jobs.heartbeat({
        jobId: fixture.candidateJob.id,
        leaseOwner: "worker:test",
        nowMs: 10,
        phase: "render_pages",
        progress: {
          completed: 4,
          processed_bytes: null,
          total: 20,
          unit: "pages",
        },
      });

      const recovered = await recoverExpiredJobLeases({
        nowMs: 60_011,
        onInterrupted: (job) =>
          terminalizeCandidateBuild({
            candidates: fixture.candidates,
            job,
            nowMs: 60_011,
            safeErrorCode: "JOB_LEASE_EXPIRED",
            state: "interrupted",
          }),
        repository: fixture.jobs,
        retryJob: (job, nowMs) =>
          retryCandidateBuild({
            automatic: true,
            candidates: fixture.candidates,
            job,
            jobs: fixture.jobs,
            nowMs,
            runAtomically: (operation) =>
              withImmediateTransaction(database, operation),
          }),
        storageRoot: dataRoot.path,
      });
      const retry = recovered[0]?.retry;
      if (!retry?.candidateId) throw new Error("CANDIDATE_RETRY_MISSING");

      expect(recovered[0]?.interrupted).toMatchObject({
        errorCode: "JOB_LEASE_EXPIRED",
        progress: { completed: 4, total: 20, unit: "pages" },
        state: "interrupted",
      });
      expect(
        fixture.candidates.require(fixture.candidate.attemptId),
      ).toMatchObject({
        safeErrorCode: "JOB_LEASE_EXPIRED",
        state: "interrupted",
      });
      expect(retry).toMatchObject({
        attempt: 2,
        automaticRetryCount: 1,
        retryOfJobId: fixture.candidateJob.id,
        state: "queued",
      });
      expect(retry.candidateId).not.toBe(fixture.candidate.attemptId);
      expect(fixture.candidates.require(retry.candidateId)).toMatchObject({
        jobId: retry.id,
        state: "building",
      });
    });
  });
});
