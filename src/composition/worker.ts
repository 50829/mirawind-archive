import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type Database from "better-sqlite3";

import { parseEnvironment } from "@/config/environment";
import { openDatabase } from "@/db/connection";
import { DraftRepository } from "@/db/repositories/drafts";
import { ImportRepository } from "@/db/repositories/imports";
import { JobRepository, type JobRecord } from "@/db/repositories/jobs";
import { SourceRepository } from "@/db/repositories/sources";
import { isJobPhase } from "@/jobs/state-machine";
import { recoverExpiredJobLeases } from "@/jobs/recovery";
import {
  persistAnalyzeImportArtifact,
  readAnalyzeImportArtifact,
} from "@/jobs/handlers/analyze-import";
import { readPreviewBuildArtifact } from "@/jobs/handlers/preview-artifact";
import { finalizeBuiltPreview } from "@/jobs/handlers/preview-finalization";
import { finalizeBuiltPublication } from "@/jobs/handlers/build-publish";
import { finalizePreparedDraft } from "@/jobs/handlers/finalize-prepared-draft";
import {
  preparedDraftArtifactPath,
  readPreparedDraftArtifact,
} from "@/jobs/handlers/prepared-draft-artifact";
import { operationalMetrics } from "@/observability/metrics";
import { atomicWriteFile, createStorageLayout } from "@/storage/layout";
import type { StorageLayout } from "@/storage/layout";
import { resolveContainedPath } from "@/storage/path-resolver";
import { reconcileStorage } from "@/storage/reconcile";
import { WorkerCheckpointScheduler } from "@/worker/checkpoint";
import { runJobChild } from "@/worker/child-runner";
import type { FrozenJobInput } from "@/worker/protocol";

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
  const preparation =
    selectedCandidate?.evidence.preparation &&
    typeof selectedCandidate.evidence.preparation === "object"
      ? (selectedCandidate.evidence.preparation as Readonly<
          Record<string, unknown>
        >)
      : null;
  const typographyProfile =
    preparation?.kind === "reprocess" &&
    (preparation.typographyProfile === "verbatim-v1" ||
      preparation.typographyProfile === "zh-smart-v1")
      ? preparation.typographyProfile
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
    createdAtMs: job.createdAtMs,
    importId: job.importId,
    importUploadRelativePath: imported?.uploadRelativePath ?? null,
    jobId: job.id,
    kind: job.kind,
    selectedCandidateRelativePath: selectedCandidate?.normalizedPath ?? null,
    sourceRootRelativePath: source?.sourceRootRelativePath ?? null,
    stagingRelativePath: `staging/${job.id}`,
    typographyProfile,
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
      if (current.cancellationRequestedAtMs !== null) {
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
            if (!isJobPhase(input.job.kind, progress.phase)) {
              throw new Error("JOB_PHASE_INVALID");
            }
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
    if (latest.cancellationRequestedAtMs !== null) {
      input.repository.completeFailure({
        errorClass: "canceled",
        errorCode: "JOB_CANCELED",
        jobId: input.job.id,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
      });
      return;
    }

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
      if (
        input.job.kind === "build_publish" &&
        input.job.bookId &&
        input.job.capturedConfigRevision
      ) {
        input.repository.heartbeat({
          jobId: input.job.id,
          leaseOwner: input.leaseOwner,
          nowMs: Date.now(),
          phase: "finalize_publication",
          progress: {
            completed: 2,
            processed_bytes: null,
            total: 3,
            unit: "steps",
          },
        });
        const expected = `staging/${input.job.id}/version-build-result.json`;
        if (
          execution.result.result?.versionBuildResultRelativePath !== expected
        ) {
          throw new Error("VERSION_BUILD_RESULT_PATH_INVALID");
        }
        await finalizeBuiltPublication({
          actorUserId: null,
          database: input.database,
          jobId: input.job.id,
          layout: input.layout,
          leaseOwner: input.leaseOwner,
          nowMs: Date.now(),
          stagingDirectory: await resolveContainedPath(
            input.layout.root,
            `staging/${input.job.id}`,
          ),
        });
        return;
      }
      input.repository.completeSuccess({
        jobId: input.job.id,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
      });
      return;
    }
    const errorClass =
      latest.cancellationRequestedAtMs !== null
        ? "canceled"
        : (execution.result.safeErrorClass ?? "infrastructure");
    const errorCode =
      latest.cancellationRequestedAtMs !== null
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
  readonly scheduler: WorkerCheckpointScheduler;
  readonly shutdownSignal: AbortSignal;
  readonly sources: SourceRepository;
  readonly workerId: string;
}): Promise<void> {
  while (!input.shutdownSignal.aborted) {
    const loopNowMs = Date.now();
    const recovered = await recoverExpiredJobLeases({
      nowMs: loopNowMs,
      repository: input.repository,
      storageRoot: input.layout.root,
    });
    for (const item of recovered) {
      operationalMetrics.recordTransition(
        item.retry ? "recovery.auto_retry" : "recovery.interrupted",
      );
    }
    await input.scheduler.checkpointIfDue(loopNowMs);
    const job = input.repository.claimNext({
      leaseOwner: input.workerId,
      nowMs: loopNowMs,
    });
    if (!job) {
      await delay(pollIntervalMs, input.shutdownSignal);
      continue;
    }
    operationalMetrics.recordQueueAge(Math.max(0, loopNowMs - job.createdAtMs));
    const startedAtMs = Date.now();
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
    operationalMetrics.recordPhase(job.kind, Date.now() - startedAtMs);
    const completed = input.repository.get(job.id);
    if (completed?.errorClass && completed.errorCode) {
      operationalMetrics.recordFailure(
        completed.errorClass,
        completed.errorCode,
      );
    }
    if (completed) {
      operationalMetrics.recordTransition(
        `job.${completed.kind}.${completed.state}`,
      );
    }
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
  const databasePath = join(environment.dataDirectory, "db", "mirawind.sqlite");
  const database = openDatabase(databasePath, { role: "worker" });
  const pidPath = join(layout.temporaryDirectory, "worker.pid");
  try {
    const bootId = randomUUID();
    const workerId = `worker:${hostname()}:${process.pid}:${bootId}`;
    const repository = new JobRepository(database);
    const recovered = await recoverExpiredJobLeases({
      nowMs: Date.now(),
      repository,
      storageRoot: layout.root,
    });
    for (const item of recovered) {
      operationalMetrics.recordTransition(
        item.retry ? "recovery.auto_retry" : "recovery.interrupted",
      );
    }
    const reconciliation = await reconcileStorage({
      database,
      layout,
      nowMs: Date.now(),
    });
    if (
      reconciliation.corruptDatabaseVersions.length > 0 ||
      reconciliation.quarantinedDirectories.length > 0 ||
      reconciliation.recoveredCurrentVersions.length > 0 ||
      reconciliation.removedStagingDirectories.length > 0
    ) {
      operationalMetrics.recordTransition("recovery.startup_changed");
    }
    const currentVersions = database
      .prepare(
        `SELECT book_versions.id, book_versions.book_id,
                book_versions.source_id, book_versions.config_revision
         FROM books
         JOIN book_versions ON book_versions.id = books.current_version_id
         WHERE book_versions.state = 'published'
           AND books.deletion_requested_at IS NULL
           AND book_versions.reclaimed_at IS NULL
         ORDER BY books.id`,
      )
      .all() as {
      book_id: number;
      config_revision: number;
      id: string;
      source_id: string;
    }[];
    for (const version of currentVersions) {
      repository.create({
        bookId: version.book_id,
        capturedConfigRevision: version.config_revision,
        capturedSourceId: version.source_id,
        idempotency: {
          key: `${bootId}:verify:${version.id}`,
          operation: "version.verify",
        },
        kind: "verify_version",
        nowMs: Date.now(),
        versionId: version.id,
      });
    }
    repository.create({
      idempotency: {
        key: `${bootId}:storage:reclaim`,
        operation: "storage.reclaim",
      },
      kind: "reclaim",
      nowMs: Date.now(),
    });
    const scheduler = new WorkerCheckpointScheduler({
      database,
      databasePath,
      layout,
    });
    await scheduler.checkpointIfDue(Date.now());
    await operationalMetrics.collectDiskUsage(layout.root);
    await atomicWriteFile(pidPath, `${process.pid}\n`, { mode: 0o600 });
    process.stdout.write("Mirawind worker ready\n");
    await runWorkerLoop({
      database,
      drafts: new DraftRepository(database),
      imports: new ImportRepository(database),
      layout,
      repository,
      scheduler,
      shutdownSignal: shutdownController.signal,
      sources: new SourceRepository(database),
      workerId,
    });
  } finally {
    await rm(pidPath, { force: true });
    database.close();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) await main();
