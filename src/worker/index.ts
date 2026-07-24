import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type Database from "better-sqlite3";

import { parseEnvironment } from "../config/environment.js";
import { openDatabase } from "../db/connection.js";
import { DraftRepository } from "../db/repositories/drafts.js";
import { ImportRepository } from "../db/repositories/imports.js";
import { JobRepository, type JobRecord } from "../db/repositories/jobs.js";
import { SourceRepository } from "../db/repositories/sources.js";
import {
  persistAnalyzeImportArtifact,
  readAnalyzeImportArtifact,
} from "../jobs/handlers/analyze-import.js";
import {
  finalizeBuiltPreview,
  readPreviewBuildArtifact,
} from "../jobs/handlers/build-preview.js";
import {
  finalizePreparedDraft,
  preparedDraftArtifactPath,
  readPreparedDraftArtifact,
} from "../jobs/handlers/prepare-draft.js";
import type { StorageLayout } from "../storage/layout.js";
import { createStorageLayout } from "../storage/layout.js";
import { resolveContainedPath } from "../storage/path-resolver.js";
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

function frozenInput(
  job: JobRecord,
  drafts: DraftRepository,
  imports: ImportRepository,
  sources: SourceRepository,
): FrozenJobInput {
  const imported =
    (job.kind === "analyze_import" || job.kind === "prepare_draft") &&
    job.importId
      ? imports.require(job.importId)
      : null;
  const selectedCandidate = imported?.selectedCandidateId
    ? imports
        .candidates(imported.id)
        .find((candidate) => candidate.id === imported.selectedCandidateId)
    : null;
  const source = job.capturedSourceId
    ? sources.requireSnapshot(job.capturedSourceId)
    : null;
  const config =
    job.bookId && job.capturedConfigRevision
      ? drafts.requireConfig(job.bookId, job.capturedConfigRevision)
      : null;
  return Object.freeze({
    attempt: job.attempt,
    bookId: imported?.bookId ?? job.bookId,
    capturedConfigRevision: job.capturedConfigRevision,
    capturedCurrentVersionId: job.capturedCurrentVersionId,
    capturedSourceId: job.capturedSourceId,
    configYamlRelativePath: config?.yamlRelativePath ?? null,
    importId: job.importId,
    importUploadRelativePath: imported?.uploadRelativePath ?? null,
    jobId: job.id,
    kind: job.kind,
    selectedCandidateRelativePath: selectedCandidate?.normalizedPath ?? null,
    sourceRootRelativePath: source?.sourceRootRelativePath ?? null,
    stagingRelativePath: `staging/${job.id}`,
    versionId: job.versionId,
  });
}

async function executeClaimedJob(input: {
  readonly database: Database.Database;
  readonly job: JobRecord;
  readonly drafts: DraftRepository;
  readonly imports: ImportRepository;
  readonly leaseOwner: string;
  readonly repository: JobRepository;
  readonly shutdownSignal: AbortSignal;
  readonly layout: StorageLayout;
  readonly sources: SourceRepository;
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
    if (input.job.kind === "analyze_import" && input.job.importId) {
      input.imports.startAnalysis(input.job.importId, Date.now());
    }
    if (input.job.kind === "prepare_draft" && input.job.importId) {
      const imported = input.imports.require(input.job.importId);
      if (imported.bookId === null) {
        const book = input.drafts.createBook({
          nowMs: Date.now(),
          title: "Pending import",
        });
        input.imports.attachBookForPreparation({
          bookId: book.id,
          importId: imported.id,
          nowMs: Date.now(),
        });
      }
    }
    const execution = await runJobChild(
      frozenInput(input.job, input.drafts, input.imports, input.sources),
      {
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
        storageRoot: input.layout.root,
      },
    );
    const latest = input.repository.get(input.job.id);
    if (!latest || latest.state !== "running") return;

    if (
      execution.result.ok &&
      execution.exitCode === 0 &&
      execution.signal === null
    ) {
      if (input.job.kind === "analyze_import" && input.job.importId) {
        const relativePath =
          execution.result.result?.analysisResultRelativePath;
        if (
          typeof relativePath !== "string" ||
          relativePath !== `staging/${input.job.id}/analysis-result.json`
        ) {
          throw new Error("IMPORT_ANALYSIS_RESULT_PATH_INVALID");
        }
        const artifact = await readAnalyzeImportArtifact(
          await resolveContainedPath(input.layout.root, relativePath),
        );
        const imported = persistAnalyzeImportArtifact({
          artifact,
          importId: input.job.importId,
          nowMs: Date.now(),
          repository: input.imports,
        });
        if (imported.state === "preparing") {
          input.repository.create({
            ...(imported.bookId === null ? {} : { bookId: imported.bookId }),
            idempotency: {
              key: `prepare-import-${imported.id}`,
              operation: "import.prepare",
            },
            importId: imported.id,
            kind: "prepare_draft",
            nowMs: Date.now(),
          });
        }
      }
      if (input.job.kind === "prepare_draft" && input.job.importId) {
        const expected = `staging/${input.job.id}/prepared-draft.json`;
        if (execution.result.result?.preparedDraftRelativePath !== expected) {
          throw new Error("PREPARED_DRAFT_RESULT_PATH_INVALID");
        }
        const stagingDirectory = await resolveContainedPath(
          input.layout.root,
          `staging/${input.job.id}`,
        );
        const artifact = await readPreparedDraftArtifact(
          preparedDraftArtifactPath(stagingDirectory),
        );
        const imported = input.imports.require(input.job.importId);
        await finalizePreparedDraft({
          artifact,
          database: input.database,
          extractedRoot: resolve(stagingDirectory, "extracted"),
          importId: imported.id,
          layout: input.layout,
          nowMs: Date.now(),
          originalArchivePath: await resolveContainedPath(
            input.layout.root,
            imported.uploadRelativePath,
          ),
        });
      }
      if (
        input.job.kind === "build_preview" &&
        input.job.bookId &&
        input.job.capturedConfigRevision
      ) {
        const expected = `staging/${input.job.id}/preview-build-result.json`;
        if (
          execution.result.result?.previewBuildResultRelativePath !== expected
        ) {
          throw new Error("PREVIEW_BUILD_RESULT_PATH_INVALID");
        }
        const stagingDirectory = await resolveContainedPath(
          input.layout.root,
          `staging/${input.job.id}`,
        );
        await finalizeBuiltPreview({
          artifact: await readPreviewBuildArtifact(stagingDirectory),
          bookId: input.job.bookId,
          configRevision: input.job.capturedConfigRevision,
          database: input.database,
          layout: input.layout,
          nowMs: Date.now(),
          stagingDirectory,
        });
      }
      input.repository.completeSuccess({
        jobId: input.job.id,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
        progress: execution.result.result ?? {},
      });
      return;
    }
    const errorClass =
      latest.requestedCancelAtMs !== null
        ? "canceled"
        : (execution.result.safeErrorClass ?? "infrastructure");
    const errorCode =
      latest.requestedCancelAtMs !== null
        ? "JOB_CANCELED"
        : (execution.result.safeErrorCode ?? "JOB_CHILD_FAILED");
    if (input.job.kind === "analyze_import" && input.job.importId) {
      if (errorClass === "canceled") {
        input.imports.cancel(input.job.importId, Date.now());
      } else if (errorClass !== "infrastructure") {
        input.imports.reject(input.job.importId, errorCode, Date.now());
      }
    }
    input.repository.completeFailure({
      errorClass,
      errorCode,
      jobId: input.job.id,
      leaseOwner: input.leaseOwner,
      nowMs: Date.now(),
    });
  } catch {
    const latest = input.repository.get(input.job.id);
    if (latest?.state === "running") {
      input.repository.completeFailure({
        errorClass: "infrastructure",
        errorCode: "WORKER_JOB_FINALIZATION_FAILED",
        jobId: input.job.id,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
      });
    }
  } finally {
    clearInterval(heartbeat);
    input.shutdownSignal.removeEventListener("abort", onShutdown);
  }
}

export async function runWorkerLoop(input: {
  readonly database: Database.Database;
  readonly drafts: DraftRepository;
  readonly imports: ImportRepository;
  readonly layout: StorageLayout;
  readonly repository: JobRepository;
  readonly shutdownSignal: AbortSignal;
  readonly sources: SourceRepository;
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
      database: input.database,
      drafts: input.drafts,
      imports: input.imports,
      leaseOwner: input.workerId,
      repository: input.repository,
      shutdownSignal: input.shutdownSignal,
      layout: input.layout,
      sources: input.sources,
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
  const layout = await createStorageLayout(environment.dataDirectory);
  const database = openDatabase(
    join(environment.dataDirectory, "db", "mirawind.sqlite"),
    { role: "worker" },
  );
  try {
    const workerId = `worker:${hostname()}:${process.pid}:${randomUUID()}`;
    process.stdout.write("Mirawind worker ready\n");
    await runWorkerLoop({
      database,
      drafts: new DraftRepository(database),
      imports: new ImportRepository(database),
      layout,
      repository: new JobRepository(database),
      shutdownSignal: shutdownController.signal,
      sources: new SourceRepository(database),
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
