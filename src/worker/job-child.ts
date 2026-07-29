import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { openDatabase } from "../db/connection.js";
import { SafeApplicationError } from "../domain/errors.js";
import { analyzeImport } from "../jobs/handlers/analyze-import.js";
import { buildPreview } from "../jobs/handlers/build-preview.js";
import { buildPublish } from "../jobs/handlers/build-publish.js";
import { prepareDraft } from "../jobs/handlers/prepare-draft.js";
import { reclaimRetainedStorage } from "../jobs/handlers/reclaim.js";
import { permanentlyCleanupBook } from "../services/permanent-book-cleanup.js";
import { reconcileRuntimeStorage } from "../jobs/handlers/reconcile.js";
import { verifyVersion } from "../jobs/handlers/verify-version.js";
import { resolveContainedPath } from "../storage/path-resolver.js";
import { createStorageLayout } from "../storage/layout.js";
import {
  isCancelJobMessage,
  isRunJobMessage,
  jobChildProtocolVersion,
  type JobProgress,
  type JobProgressMessage,
  type JobResultMessage,
  type RunJobMessage,
} from "./protocol.js";
import { shouldReportJobProgress } from "./progress-throttle.js";
import {
  finishPipelineProfile,
  startPipelineProfile,
} from "../observability/pipeline-profile.js";

let active: RunJobMessage | undefined;
const controller = new AbortController();
let lastProgressAt = 0;
let lastProgressPhase: string | null = null;

function send(result: JobResultMessage): void {
  void finishPipelineProfile(result.ok ? "passed" : "failed")
    .catch(() => undefined)
    .then(() => {
      process.send?.(result, () => {
        if (process.connected) process.disconnect();
      });
    });
}

function reportProgress(
  phase: JobProgressMessage["phase"],
  progress: JobProgress,
): void {
  if (!active) return;
  const now = Date.now();
  if (
    !shouldReportJobProgress({
      lastPhase: lastProgressPhase,
      lastReportedAtMs: lastProgressAt,
      nowMs: now,
      phase,
    })
  ) {
    return;
  }
  lastProgressAt = now;
  lastProgressPhase = phase;
  process.send?.({
    jobId: active.input.jobId,
    phase,
    progress,
    protocolVersion: jobChildProtocolVersion,
    type: "progress",
  } satisfies JobProgressMessage);
}

function steps(completed: number, total: number): JobProgress {
  return Object.freeze({
    completed,
    processed_bytes: null,
    total,
    unit: "steps",
  });
}

function storageRoot(): string {
  const value = process.env.MIRAWIND_JOB_STORAGE_ROOT;
  if (!value || !isAbsolute(value) || resolve(value) === sep) {
    throw new Error("JOB_STORAGE_ROOT_INVALID");
  }
  return resolve(value);
}

function safeErrorClass(
  error: unknown,
): NonNullable<JobResultMessage["safeErrorClass"]> {
  if (!(error instanceof SafeApplicationError)) return "infrastructure";
  if (error.code.includes("CANCELED")) return "canceled";
  if (error.code.includes("TIMEOUT")) return "timeout";
  if (error.code.includes("LIMIT") || error.code.startsWith("ARCHIVE_")) {
    return "security_limit";
  }
  return "content";
}

function safeErrorCode(error: unknown): string {
  if (error instanceof SafeApplicationError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/u.test(error.message)) {
    return error.message;
  }
  return "JOB_HANDLER_FAILED";
}

async function execute(message: RunJobMessage): Promise<void> {
  try {
    await startPipelineProfile({
      jobId: message.input.jobId,
      jobKind: message.input.kind,
    });
    const root = storageRoot();
    const stagingDirectory = await resolveContainedPath(
      root,
      message.input.stagingRelativePath,
    );
    if (
      message.input.kind === "analyze_import" &&
      message.input.importUploadRelativePath
    ) {
      reportProgress("security_check", steps(0, 2));
      const archivePath = await resolveContainedPath(
        root,
        message.input.importUploadRelativePath,
      );
      const result = await analyzeImport({
        archivePath,
        signal: controller.signal,
        stagingDirectory,
      });
      reportProgress("identify_document", steps(2, 2));
      send({
        jobId: message.input.jobId,
        ok: true,
        protocolVersion: jobChildProtocolVersion,
        result: {
          analysisResultRelativePath: relative(root, result.artifactPath)
            .split(sep)
            .join("/"),
          candidates: result.artifact.candidates.length,
          decision: result.artifact.decision,
          entries: result.entries,
          files: result.files,
          totalUncompressedBytes: result.totalUncompressedBytes,
        },
        type: "result",
      });
      return;
    }
    if (
      message.input.kind === "verify_version" &&
      message.input.versionId !== null
    ) {
      reportProgress("verify_manifest", steps(0, 1));
      const database = openDatabase(join(root, "db", "mirawind.sqlite"), {
        role: "worker",
      });
      try {
        const outcome = await verifyVersion({
          database,
          layout: await createStorageLayout(root),
          nowMs: Date.now(),
          versionId: message.input.versionId,
        });
        send({
          jobId: message.input.jobId,
          ok: outcome.result.ok,
          protocolVersion: jobChildProtocolVersion,
          ...(outcome.result.ok
            ? {
                result: {
                  recovered: outcome.recovery !== null,
                  version_id: outcome.versionId,
                },
              }
            : {
                safeErrorClass: "content",
                safeErrorCode: outcome.result.code,
              }),
          type: "result",
        });
      } finally {
        database.close();
      }
      return;
    }
    if (message.input.kind === "reconcile") {
      reportProgress("reconcile_storage", steps(0, 1));
      const database = openDatabase(join(root, "db", "mirawind.sqlite"), {
        role: "worker",
      });
      try {
        const outcome = await reconcileRuntimeStorage({
          database,
          layout: await createStorageLayout(root),
          nowMs: Date.now(),
        });
        send({
          jobId: message.input.jobId,
          ok: true,
          protocolVersion: jobChildProtocolVersion,
          result: {
            corrupt_versions: outcome.corruptDatabaseVersions.length,
            quarantined: outcome.quarantinedDirectories.length,
            recovered_current: outcome.recoveredCurrentVersions.length,
            removed_staging: outcome.removedStagingDirectories.length,
          },
          type: "result",
        });
      } finally {
        database.close();
      }
      return;
    }
    if (message.input.kind === "reclaim") {
      reportProgress(
        message.input.bookId ? "permanent_book_deletion" : "reclaim_storage",
        steps(0, 1),
      );
      const database = openDatabase(join(root, "db", "mirawind.sqlite"), {
        role: "worker",
      });
      try {
        const layout = await createStorageLayout(root);
        const deletionOutcome = message.input.bookId
          ? await permanentlyCleanupBook({
              bookId: message.input.bookId,
              database,
              jobId: message.input.jobId,
              layout,
              nowMs: Date.now(),
            })
          : null;
        const outcome = deletionOutcome
          ? null
          : await reclaimRetainedStorage({
              database,
              layout,
              nowMs: Date.now(),
            });
        send({
          jobId: message.input.jobId,
          ok: deletionOutcome !== null || outcome?.failedPaths.length === 0,
          protocolVersion: jobChildProtocolVersion,
          ...(deletionOutcome
            ? {
                result: {
                  removed_staging: deletionOutcome.removedStagingDirectories,
                  removed_uploads: deletionOutcome.removedUploadDirectories,
                },
              }
            : outcome && outcome.failedPaths.length === 0
              ? {
                  result: {
                    reclaimed_versions: outcome.reclaimedVersionIds.length,
                    removed_quarantine: outcome.removedQuarantinePaths.length,
                  },
                }
              : {
                  safeErrorClass: "infrastructure",
                  safeErrorCode: "RECLAIM_CLEANUP_INCOMPLETE",
                }),
          type: "result",
        });
      } finally {
        database.close();
      }
      return;
    }
    if (
      message.input.kind === "prepare_draft" &&
      message.input.importUploadRelativePath &&
      message.input.selectedCandidateRelativePath
    ) {
      reportProgress("security_check", steps(0, 3));
      reportProgress("identify_document", steps(1, 3));
      const result = await prepareDraft({
        archivePath: await resolveContainedPath(
          root,
          message.input.importUploadRelativePath,
        ),
        selectedCandidatePath: message.input.selectedCandidateRelativePath,
        signal: controller.signal,
        stagingDirectory,
        ...(message.input.typographyProfile
          ? { typographyProfile: message.input.typographyProfile }
          : {}),
      });
      reportProgress("organize_structure", steps(3, 3));
      send({
        jobId: message.input.jobId,
        ok: true,
        protocolVersion: jobChildProtocolVersion,
        result: {
          preparedDraftRelativePath: relative(root, result.artifactPath)
            .split(sep)
            .join("/"),
        },
        type: "result",
      });
      return;
    }
    if (
      message.input.kind === "build_preview" &&
      message.input.bookId &&
      message.input.capturedConfigRevision &&
      message.input.capturedSourceId &&
      message.input.configYamlRelativePath &&
      message.input.sourceRootRelativePath
    ) {
      reportProgress("render_pages", steps(0, 1));
      await buildPreview({
        analysisPath: await resolveContainedPath(
          root,
          `books/${message.input.bookId}/draft/analyses/${message.input.capturedSourceId}/${message.input.capturedConfigRevision}.json`,
        ),
        bookId: message.input.bookId,
        configRevision: message.input.capturedConfigRevision,
        configYamlPath: await resolveContainedPath(
          root,
          message.input.configYamlRelativePath,
        ),
        sourceRoot: await resolveContainedPath(
          root,
          message.input.sourceRootRelativePath,
        ),
        sourceId: message.input.capturedSourceId,
        stagingDirectory,
      });
      send({
        jobId: message.input.jobId,
        ok: true,
        protocolVersion: jobChildProtocolVersion,
        result: {
          previewBuildResultRelativePath: `${message.input.stagingRelativePath}/preview-build-result.json`,
        },
        type: "result",
      });
      return;
    }
    if (
      message.input.kind === "build_publish" &&
      message.input.bookId &&
      message.input.capturedConfigRevision &&
      message.input.capturedSourceId &&
      message.input.configYamlRelativePath &&
      message.input.sourceRootRelativePath
    ) {
      reportProgress("render_pages", steps(0, 3));
      await buildPublish({
        bookId: message.input.bookId,
        configRevision: message.input.capturedConfigRevision,
        configYamlPath: await resolveContainedPath(
          root,
          message.input.configYamlRelativePath,
        ),
        createdAtMs: message.input.createdAtMs,
        draftRoot: await resolveContainedPath(
          root,
          `books/${message.input.bookId}/draft`,
        ),
        jobId: message.input.jobId,
        predecessorVersionId: message.input.capturedCurrentVersionId,
        sourceId: message.input.capturedSourceId,
        sourceRoot: await resolveContainedPath(
          root,
          message.input.sourceRootRelativePath,
        ),
        stagingDirectory,
      });
      reportProgress("build_search", steps(2, 3));
      send({
        jobId: message.input.jobId,
        ok: true,
        protocolVersion: jobChildProtocolVersion,
        result: {
          versionBuildResultRelativePath: `${message.input.stagingRelativePath}/version-build-result.json`,
        },
        type: "result",
      });
      return;
    }
    throw new SafeApplicationError(
      "JOB_HANDLER_NOT_IMPLEMENTED",
      "The job handler is not implemented.",
      500,
    );
  } catch (error) {
    send({
      jobId: message.input.jobId,
      ok: false,
      protocolVersion: jobChildProtocolVersion,
      safeErrorClass: safeErrorClass(error),
      safeErrorCode: safeErrorCode(error),
      type: "result",
    });
  }
}

process.on("message", (message: unknown) => {
  if (isCancelJobMessage(message)) {
    if (active?.input.jobId === message.jobId) controller.abort();
    return;
  }
  if (!isRunJobMessage(message) || active) {
    send({
      jobId:
        typeof message === "object" &&
        message !== null &&
        "jobId" in message &&
        typeof message.jobId === "string"
          ? message.jobId
          : "job_invalid",
      ok: false,
      protocolVersion: jobChildProtocolVersion,
      safeErrorClass: "infrastructure",
      safeErrorCode: "INVALID_JOB_CHILD_REQUEST",
      type: "result",
    });
    return;
  }
  active = message;
  if (controller.signal.aborted) {
    send({
      jobId: message.input.jobId,
      ok: false,
      protocolVersion: jobChildProtocolVersion,
      safeErrorClass: "canceled",
      safeErrorCode: "JOB_CANCELED",
      type: "result",
    });
    return;
  }
  void execute(message);
});
