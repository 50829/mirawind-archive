import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type {
  AnalyzeImportCommand,
  PrepareDraftCommand,
  SaveDraftCommand,
} from "@/entrypoints/worker/protocol";
import type { BuildCandidateCommand } from "@/modules/publishing/application/publishing-api";
import { handleBuildCandidate } from "@/entrypoints/worker/handlers/build-candidate";
import { analyzeImport } from "@/modules/publishing/adapters/worker/analyze-import";
import { buildCandidateVersion } from "@/modules/publishing/adapters/filesystem/build-candidate-version";
import { prepareDraft } from "@/modules/publishing/adapters/worker/prepare-draft";
import { prepareDraftSave } from "@/modules/publishing/adapters/worker/prepare-draft-save";
import type { SafeDiagnostic } from "@/domain/errors";
import { createStorageLayout } from "@/platform/filesystem/storage-layout";
import { resolveContainedPath } from "@/platform/filesystem/contained-path";
import {
  stepProgress,
  type WorkerChildContext,
  type WorkerChildOutcome,
} from "../job-handler";

export async function buildCandidateHandler(
  command: BuildCandidateCommand,
  context: WorkerChildContext,
): Promise<WorkerChildOutcome> {
  const layout = await createStorageLayout(context.root);
  const snapshotPath = await resolveContainedPath(
    context.root,
    command.inputRelativePath,
  );
  const analysis = JSON.parse(
    await readFile(resolve(dirname(snapshotPath), "analysis.json"), "utf8"),
  ) as { diagnostics: readonly SafeDiagnostic[] };
  const artifact = await handleBuildCandidate({
    command,
    execute: ({ command: captured, onStage, signal }) =>
      buildCandidateVersion({
        command: captured,
        createdAtMs: Date.now(),
        layout,
        onStage,
        preparationDiagnostics: analysis.diagnostics,
        ...(signal ? { signal } : {}),
      }),
    onProgress(progress) {
      context.reportProgress(progress.phase, progress.progress);
    },
    signal: context.signal,
  });
  return Object.freeze({ ok: true, result: Object.freeze({ ...artifact }) });
}

export async function analyzeImportHandler(
  command: AnalyzeImportCommand,
  context: WorkerChildContext,
): Promise<WorkerChildOutcome> {
  const stagingDirectory = await resolveContainedPath(
    context.root,
    command.stagingRelativePath,
  );
  const archivePath = await resolveContainedPath(
    context.root,
    command.importUploadRelativePath,
  );
  const result = await analyzeImport({
    archivePath,
    importId: command.importId,
    onPhase(phase, completed, total) {
      context.reportProgress(phase, stepProgress(completed, total));
    },
    sealedExtractionDirectory: resolve(
      dirname(archivePath),
      "sealed-extraction",
    ),
    signal: context.signal,
    stagingDirectory,
  });
  return Object.freeze({
    ok: true,
    result: Object.freeze({
      analysisResultRelativePath: relative(context.root, result.artifactPath)
        .split(sep)
        .join("/"),
      candidates: result.artifact.candidates.length,
      decision: result.artifact.decision,
      entries: result.entries,
      files: result.files,
      totalUncompressedBytes: result.totalUncompressedBytes,
    }),
  });
}

export async function prepareDraftHandler(
  command: PrepareDraftCommand,
  context: WorkerChildContext,
): Promise<WorkerChildOutcome> {
  const stagingDirectory = await resolveContainedPath(
    context.root,
    command.stagingRelativePath,
  );
  const archivePath = await resolveContainedPath(
    context.root,
    command.importUploadRelativePath,
  );
  const result = await prepareDraft({
    archivePath,
    bookId: command.bookId,
    importId: command.importId,
    onPhase(phase, completed, total) {
      context.reportProgress(phase, stepProgress(completed, total));
    },
    sealedExtractionDirectory: resolve(
      dirname(archivePath),
      "sealed-extraction",
    ),
    selectedCandidatePath: command.selectedCandidateRelativePath,
    signal: context.signal,
    stagingDirectory,
  });
  return Object.freeze({
    ok: true,
    result: Object.freeze({
      preparedDraftRelativePath: relative(context.root, result.artifactPath)
        .split(sep)
        .join("/"),
    }),
  });
}

export async function saveDraftHandler(
  command: SaveDraftCommand,
  context: WorkerChildContext,
): Promise<WorkerChildOutcome> {
  const result = await prepareDraftSave({
    root: context.root,
    bookId: command.bookId,
    requestPath: await resolveContainedPath(
      context.root,
      command.requestRelativePath,
    ),
    stagingDirectory: await resolveContainedPath(
      context.root,
      command.stagingRelativePath,
    ),
    signal: context.signal,
    onPhase(phase, completed, total) {
      context.reportProgress(phase, stepProgress(completed, total));
    },
  });
  return { ok: true, result };
}
