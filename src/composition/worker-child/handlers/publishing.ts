import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type {
  AnalyzeImportCommand,
  PrepareDraftCommand,
} from "@/entrypoints/worker/protocol";
import type { BuildCandidateCommand } from "@/modules/publishing/application/public";
import { handleBuildCandidate } from "@/entrypoints/worker/handlers/build-candidate";
import { analyzeImport } from "@/modules/publishing/adapters/worker/analyze-import";
import { buildCandidateVersion } from "@/modules/publishing/adapters/filesystem/build-candidate-version";
import { prepareDraft } from "@/modules/publishing/adapters/worker/prepare-draft";
import {
  printedContentsDiagnostics,
  readPinnedAnalysis,
} from "@/modules/publishing/adapters/worker/preview-diagnostics";
import { parseBookConfigYaml } from "@/modules/publishing/core/publication/book-config-schema";
import { createStorageLayout } from "@/platform/filesystem/layout";
import { resolveContainedPath } from "@/platform/filesystem/layout";
import {
  stepProgress,
  type WorkerChildContext,
  type WorkerChildOutcome,
} from "@/composition/worker-child/types";

export async function buildCandidateHandler(
  command: BuildCandidateCommand,
  context: WorkerChildContext,
): Promise<WorkerChildOutcome> {
  const layout = await createStorageLayout(context.root);
  const configPath = await resolveContainedPath(
    context.root,
    command.configRelativePath,
  );
  const config = parseBookConfigYaml(await readFile(configPath, "utf8"));
  const source = config.source as Readonly<Record<string, unknown>>;
  const analysis = await readPinnedAnalysis({
    analysisPath: await resolveContainedPath(
      context.root,
      `books/${command.bookId}/draft/analyses/${command.sourceId}/${command.configRevision}.json`,
    ),
    configRevision: command.configRevision,
    sourceId: command.sourceId,
    sourceSha256: String(source.main_markdown_sha256),
  });
  const artifact = await handleBuildCandidate({
    command,
    execute: ({ command: captured, onStage, signal }) =>
      buildCandidateVersion({
        command: captured,
        createdAtMs: Date.now(),
        layout,
        onStage,
        preparationDiagnostics: printedContentsDiagnostics(analysis),
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
    ...(command.typographyProfile
      ? { typographyProfile: command.typographyProfile }
      : {}),
  });
  return Object.freeze({
    ok: true,
    result: Object.freeze({
      preparedDraftRelativePath: relative(context.root, result.artifactPath)
        .split(sep)
        .join("/"),
      preparedSourceFilesRelativePath: relative(
        context.root,
        result.sourceFilesPath,
      )
        .split(sep)
        .join("/"),
    }),
  });
}
