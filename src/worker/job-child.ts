import { isAbsolute, relative, resolve, sep } from "node:path";

import { SafeApplicationError } from "../domain/errors.js";
import { analyzeImport } from "../jobs/handlers/analyze-import.js";
import { buildPreview } from "../jobs/handlers/build-preview.js";
import { buildPublish } from "../jobs/handlers/build-publish.js";
import { prepareDraft } from "../jobs/handlers/prepare-draft.js";
import { resolveContainedPath } from "../storage/path-resolver.js";
import {
  isCancelJobMessage,
  isRunJobMessage,
  jobChildProtocolVersion,
  type JobResultMessage,
  type RunJobMessage,
} from "./protocol.js";

let active: RunJobMessage | undefined;
const controller = new AbortController();

function send(result: JobResultMessage): void {
  process.send?.(result, () => {
    if (process.connected) process.disconnect();
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

async function execute(message: RunJobMessage): Promise<void> {
  try {
    const root = storageRoot();
    const stagingDirectory = await resolveContainedPath(
      root,
      message.input.stagingRelativePath,
    );
    if (
      message.input.kind === "analyze_import" &&
      message.input.importUploadRelativePath
    ) {
      const archivePath = await resolveContainedPath(
        root,
        message.input.importUploadRelativePath,
      );
      const result = await analyzeImport({
        archivePath,
        signal: controller.signal,
        stagingDirectory,
      });
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
      message.input.kind === "prepare_draft" &&
      message.input.importUploadRelativePath &&
      message.input.selectedCandidateRelativePath
    ) {
      const result = await prepareDraft({
        archivePath: await resolveContainedPath(
          root,
          message.input.importUploadRelativePath,
        ),
        selectedCandidatePath: message.input.selectedCandidateRelativePath,
        signal: controller.signal,
        stagingDirectory,
      });
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
      message.input.configYamlRelativePath &&
      message.input.sourceRootRelativePath
    ) {
      await buildPreview({
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
      safeErrorCode:
        error instanceof SafeApplicationError
          ? error.code
          : "JOB_HANDLER_FAILED",
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
