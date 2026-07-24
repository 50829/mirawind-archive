import { describe, expect, it } from "vitest";

import type { JobRecord } from "@/db/repositories/jobs";
import { evaluateJobRetry } from "@/jobs/retry-policy";

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
    progress: {},
    requestedCancelAtMs: null,
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
