import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";

import { finalizeBookDeletion } from "../book-deletion";
import {
  cancelImportJob,
  completeJobFailure,
  completeJobInterruption,
  retryJobAttempt,
} from "./attempt-lifecycle";
import {
  workerHeartbeatIntervalMs,
  type WorkerAttemptExecutionOutcome,
} from "./execute-attempt";
import { BookPresentationRepository } from "@/modules/catalog/adapters/sqlite/book-presentations";
import { CandidateRegistrationAdapter } from "@/modules/publishing/adapters/sqlite/candidate-registration";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import {
  JobRepository,
  type JobRecord,
} from "@/modules/publishing/adapters/sqlite/jobs";
import {
  persistAnalyzeImportArtifact,
  readAnalyzeImportArtifact,
} from "@/modules/publishing/adapters/worker/analyze-import";
import { finalizePreparedDraft } from "@/modules/publishing/adapters/worker/finalize-prepared-draft";
import { finalizeDraftSave } from "@/modules/publishing/adapters/worker/finalize-draft-save";
import {
  preparedDraftArtifactPath,
  readPreparedDraftArtifact,
} from "@/modules/publishing/adapters/worker/prepared-draft-artifact";
import {
  evaluateJobRetry,
  finalizeCandidate,
} from "@/modules/publishing/application/publishing-api";
import type { ProcessTreeMemoryObservation } from "@/observability/attempt-observation";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { resolveContainedPath } from "@/platform/filesystem/contained-path";

export async function completeWorkerAttempt(input: {
  readonly candidates: DraftCandidateRepository;
  readonly database: Database.Database;
  readonly imports: ImportRepository;
  readonly job: JobRecord;
  readonly layout: StorageLayout;
  readonly leaseOwner: string;
  readonly outcome: WorkerAttemptExecutionOutcome;
  readonly repository: JobRepository;
}): Promise<ProcessTreeMemoryObservation> {
  const memory =
    input.outcome.kind === "child_closed"
      ? input.outcome.execution.memory
      : input.outcome.memory;
  const heartbeat = setInterval(() => {
    try {
      input.repository.heartbeat({
        jobId: input.job.id,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
      });
    } catch {
      /* Final commits independently recheck lease ownership. */
    }
  }, workerHeartbeatIntervalMs);
  try {
    const latest = input.repository.get(input.job.id);
    if (!latest || latest.state !== "running") return memory;
    if (latest.cancellationRequestedAtMs !== null) {
      await cancelImportJob({
        imports: input.imports,
        job: input.job,
        layout: input.layout,
        nowMs: Date.now(),
      });
      completeJobFailure({
        candidates: input.candidates,
        database: input.database,
        errorClass: "canceled",
        errorCode:
          latest.errorCode === "CANDIDATE_SUPERSEDED"
            ? "CANDIDATE_SUPERSEDED"
            : "JOB_CANCELED",
        job: input.job,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
        repository: input.repository,
      });
      return memory;
    }
    if (input.outcome.kind === "execution_failed") {
      completeJobFailure({
        candidates: input.candidates,
        database: input.database,
        errorClass: "infrastructure",
        errorCode: input.outcome.errorCode,
        job: input.job,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
        repository: input.repository,
      });
      return memory;
    }
    const { command, execution } = input.outcome;
    if (input.outcome.shutdownRequested) {
      const interrupted = completeJobInterruption({
        candidates: input.candidates,
        database: input.database,
        errorCode: "WORKER_SHUTDOWN",
        job: input.job,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
        repository: input.repository,
      });
      if (evaluateJobRetry(interrupted, "automatic").allowed) {
        retryJobAttempt({
          automatic: true,
          candidates: input.candidates,
          database: input.database,
          job: interrupted,
          jobs: input.repository,
          nowMs: Date.now(),
        });
      }
      return memory;
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
        await rm(
          await resolveContainedPath(
            input.layout.root,
            `staging/${input.job.id}`,
          ),
          { force: true, recursive: true },
        );
      }
      if (input.job.kind === "prepare_draft" && input.job.importId) {
        const expectedArtifact = `staging/${input.job.id}/prepared-draft.json`;
        if (
          execution.result.result?.preparedDraftRelativePath !==
          expectedArtifact
        ) {
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
          preparedRoot: resolve(stagingDirectory, "prepared"),
          importId: imported.id,
          layout: input.layout,
          nowMs: Date.now(),
        });
        await rm(stagingDirectory, { force: true, recursive: true });
      }
      if (input.job.kind === "save_draft") {
        if (!execution.result.result)
          throw new Error("DRAFT_SAVE_RESULT_MISSING");
        await finalizeDraftSave({
          database: input.database,
          layout: input.layout,
          jobId: input.job.id,
          leaseOwner: input.leaseOwner,
          nowMs: Date.now(),
          result: execution.result.result,
        });
        await rm(resolve(input.layout.root, "staging", input.job.id), {
          force: true,
          recursive: true,
        });
        return memory;
      }
      if (input.job.kind === "build_candidate") {
        if (command.kind !== "build_candidate") {
          throw new Error("BUILD_CANDIDATE_INPUT_INVALID");
        }
        await finalizeCandidate({
          artifact: execution.result.result,
          command,
          leaseOwner: input.leaseOwner,
          nowMs: Date.now(),
          registration: new CandidateRegistrationAdapter(
            input.database,
            input.layout,
            new BookPresentationRepository(input.database),
          ),
        });
        return memory;
      }
      if (input.job.kind === "purge_book") {
        if (input.job.bookId === null)
          throw new Error("PURGE_BOOK_INPUT_INVALID");
        finalizeBookDeletion({
          bookId: input.job.bookId,
          database: input.database,
          jobId: input.job.id,
          leaseOwner: input.leaseOwner,
          nowMs: Date.now(),
        });
        return memory;
      }
      input.repository.completeSuccess({
        jobId: input.job.id,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
      });
      return memory;
    }

    const errorClass = execution.result.safeErrorClass ?? "infrastructure";
    const errorCode = execution.result.safeErrorCode ?? "JOB_CHILD_FAILED";
    if (
      (input.job.kind === "analyze_import" ||
        input.job.kind === "prepare_draft") &&
      input.job.importId
    ) {
      if (errorClass === "canceled") {
        await cancelImportJob({
          imports: input.imports,
          job: input.job,
          layout: input.layout,
          nowMs: Date.now(),
        });
      } else if (
        input.job.kind === "analyze_import" &&
        errorClass !== "infrastructure"
      ) {
        input.imports.reject(input.job.importId, errorCode, Date.now());
      }
    }
    completeJobFailure({
      candidates: input.candidates,
      database: input.database,
      errorClass,
      errorCode,
      job: input.job,
      leaseOwner: input.leaseOwner,
      nowMs: Date.now(),
      repository: input.repository,
    });
  } catch (error) {
    const latest = input.repository.get(input.job.id);
    if (latest?.state === "running") {
      const errorCode =
        error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/u.test(error.message)
          ? error.message
          : "WORKER_JOB_FINALIZATION_FAILED";
      completeJobFailure({
        candidates: input.candidates,
        database: input.database,
        errorClass: "infrastructure",
        errorCode,
        job: input.job,
        leaseOwner: input.leaseOwner,
        nowMs: Date.now(),
        repository: input.repository,
      });
    }
  } finally {
    clearInterval(heartbeat);
  }
  return memory;
}
