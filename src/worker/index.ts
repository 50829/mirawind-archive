import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnvironment } from "../config/environment.js";
import { openDatabase } from "../db/connection.js";
import { JobRepository, type JobRecord } from "../db/repositories/jobs.js";
import { createStorageLayout } from "../storage/layout.js";
import { runJobChild } from "./child-runner.js";
import type { FrozenJobInput } from "./protocol.js";

const pollIntervalMs = 1_000;
const heartbeatIntervalMs = 10_000;

function runtimeMode(): "development" | "production" | "test" {
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "test") return "test";
  return "development";
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function frozenInput(job: JobRecord): FrozenJobInput {
  return Object.freeze({
    attempt: job.attempt,
    bookId: job.bookId,
    capturedConfigRevision: job.capturedConfigRevision,
    capturedCurrentVersionId: job.capturedCurrentVersionId,
    capturedSourceId: job.capturedSourceId,
    importId: job.importId,
    jobId: job.id,
    kind: job.kind,
    stagingRelativePath: `staging/${job.id}`,
    versionId: job.versionId,
  });
}

async function executeClaimedJob(input: {
  readonly job: JobRecord;
  readonly leaseOwner: string;
  readonly repository: JobRepository;
  readonly shutdownSignal: AbortSignal;
}): Promise<void> {
  const childController = new AbortController();
  const onShutdown = () => childController.abort("worker-shutdown");
  input.shutdownSignal.addEventListener("abort", onShutdown, { once: true });

  const heartbeat = setInterval(() => {
    try {
      const current = input.repository.heartbeat({
        jobId: input.job.id,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
      });
      if (current.requestedCancelAtMs !== null) {
        childController.abort("cancellation-requested");
      }
    } catch {
      childController.abort("lease-lost");
    }
  }, heartbeatIntervalMs);

  try {
    const execution = await runJobChild(frozenInput(input.job), {
      onProgress(progress) {
        try {
          input.repository.heartbeat({
            jobId: input.job.id,
            leaseOwner: input.leaseOwner,
            nowMs: Date.now(),
            phase: progress.phase,
            progress: progress.progress,
          });
        } catch {
          childController.abort("progress-lease-lost");
        }
      },
      signal: childController.signal,
    });
    const latest = input.repository.get(input.job.id);
    if (!latest || latest.state !== "running") return;

    if (
      execution.result.ok &&
      execution.exitCode === 0 &&
      execution.signal === null
    ) {
      input.repository.completeSuccess({
        jobId: input.job.id,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
        progress: execution.result.result ?? {},
      });
      return;
    }
    input.repository.completeFailure({
      errorClass:
        latest.requestedCancelAtMs !== null
          ? "canceled"
          : (execution.result.safeErrorClass ?? "infrastructure"),
      errorCode:
        latest.requestedCancelAtMs !== null
          ? "JOB_CANCELED"
          : (execution.result.safeErrorCode ?? "JOB_CHILD_FAILED"),
      jobId: input.job.id,
      leaseOwner: input.leaseOwner,
      nowMs: Date.now(),
    });
  } finally {
    clearInterval(heartbeat);
    input.shutdownSignal.removeEventListener("abort", onShutdown);
  }
}

export async function runWorkerLoop(input: {
  readonly repository: JobRepository;
  readonly shutdownSignal: AbortSignal;
  readonly workerId: string;
}): Promise<void> {
  while (!input.shutdownSignal.aborted) {
    input.repository.interruptExpired({ nowMs: Date.now() });
    const job = input.repository.claimNext({
      leaseOwner: input.workerId,
      nowMs: Date.now(),
    });
    if (!job) {
      await delay(pollIntervalMs, input.shutdownSignal);
      continue;
    }
    await executeClaimedJob({
      job,
      leaseOwner: input.workerId,
      repository: input.repository,
      shutdownSignal: input.shutdownSignal,
    });
  }
}

async function main(): Promise<void> {
  const shutdownController = new AbortController();
  const requestShutdown = (signal: NodeJS.Signals) => {
    if (!shutdownController.signal.aborted) {
      shutdownController.abort(signal);
    }
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

  const environment = parseEnvironment(process.env, { mode: runtimeMode() });
  await createStorageLayout(environment.dataDirectory);
  const database = openDatabase(
    join(environment.dataDirectory, "db", "mirawind.sqlite"),
    { role: "worker" },
  );
  try {
    const workerId = `worker:${hostname()}:${process.pid}:${randomUUID()}`;
    process.stdout.write("Mirawind worker ready\n");
    await runWorkerLoop({
      repository: new JobRepository(database),
      shutdownSignal: shutdownController.signal,
      workerId,
    });
  } finally {
    database.close();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) await main();
