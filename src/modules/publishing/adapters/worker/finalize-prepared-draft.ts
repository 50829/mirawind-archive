import { createHash } from "node:crypto";
import { chmod, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";
import { stringify } from "yaml";

import { canonicalJson } from "@/modules/publishing/core/publication/manifest";
import { createPrintedContentsAnalysisV2 } from "@/modules/publishing/core/preparation/printed-contents-analysis";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import {
  ImportRepository,
  type ReprocessPreparationEvidence,
} from "@/modules/publishing/adapters/sqlite/imports";
import {
  JobRepository,
  type JobRecord,
} from "@/modules/publishing/adapters/sqlite/jobs";
import {
  draftPreparationVersion,
  type PreparedDraftArtifact,
} from "@/modules/publishing/adapters/worker/prepared-draft-artifact";
import {
  parseBookConfigYaml,
  validateBookConfig,
} from "@/modules/publishing/core/publication/book-config-schema";
import {
  SourceSnapshotService,
  type SourceSnapshotResult,
} from "@/modules/publishing/adapters/filesystem/source-snapshot";
import {
  atomicWriteFile,
  resolveContainedPath,
  type StorageLayout,
} from "@/platform/filesystem/layout";

export interface FinalizedPreparedDraft {
  readonly bookId: number;
  readonly configRevision: number;
  readonly previewJob: JobRecord;
  readonly snapshot: SourceSnapshotResult;
}

function configFor(input: {
  readonly baseConfig?: Readonly<Record<string, unknown>>;
  readonly bookId: number;
  readonly revision: number;
  readonly snapshot: SourceSnapshotResult;
  readonly sourceRegions: PreparedDraftArtifact["sourceRegions"];
  readonly structure: PreparedDraftArtifact["structure"];
  readonly title: string;
  readonly typography: PreparedDraftArtifact["typography"];
}): Readonly<Record<string, unknown>> {
  if (
    input.typography.output_sha256 !== input.snapshot.source.mainMarkdownSha256
  ) {
    throw new Error("PREPROCESS_OUTPUT_HASH_MISMATCH");
  }
  if (
    input.sourceRegions.some(
      (region) =>
        region.source_path !== input.snapshot.source.mainMarkdownPath ||
        region.source_sha256 !== input.snapshot.source.mainMarkdownSha256,
    )
  ) {
    throw new Error("SOURCE_REGION_SNAPSHOT_MISMATCH");
  }
  return validateBookConfig({
    ...(input.baseConfig ?? {}),
    book_id: input.bookId,
    publishing: input.baseConfig?.publishing ?? {
      code: { line_numbers: false },
      numbering: { mode: "normalized" },
    },
    revision: input.revision,
    schema_version: 3,
    source: {
      main_markdown: input.snapshot.source.mainMarkdownPath,
      main_markdown_sha256: input.snapshot.source.mainMarkdownSha256,
      original_files: [
        {
          filename: input.snapshot.original.originalName,
          id: input.snapshot.original.id,
          media_type: input.snapshot.original.mediaType,
          path: `originals/${input.snapshot.original.id}`,
          role: "mineru_zip",
          sha256: input.snapshot.original.sha256,
          size: input.snapshot.original.sizeBytes,
        },
      ],
      preprocessing: { typography: input.typography },
    },
    source_regions: input.sourceRegions,
    structure: input.structure,
    title: input.title,
  });
}

function reprocessEvidence(
  imports: ImportRepository,
  importId: string,
): ReprocessPreparationEvidence | null {
  const imported = imports.require(importId);
  if (!imported.selectedCandidateId) return null;
  const candidate = imports
    .candidates(importId)
    .find((value) => value.id === imported.selectedCandidateId);
  const value = candidate?.evidence.preparation;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const evidence = value as Record<string, unknown>;
  if (
    evidence.kind !== "reprocess" ||
    !Number.isSafeInteger(evidence.expectedConfigRevision) ||
    Number(evidence.expectedConfigRevision) < 1 ||
    typeof evidence.expectedSourceId !== "string" ||
    typeof evidence.originalFileId !== "string" ||
    (evidence.typographyProfile !== "verbatim-v1" &&
      evidence.typographyProfile !== "zh-smart-v1")
  ) {
    throw new Error("REPROCESS_EVIDENCE_INVALID");
  }
  return Object.freeze({
    expectedConfigRevision: Number(evidence.expectedConfigRevision),
    expectedSourceId: evidence.expectedSourceId,
    kind: "reprocess",
    originalFileId: evidence.originalFileId,
    typographyProfile: evidence.typographyProfile,
  });
}

export async function finalizePreparedDraft(input: {
  readonly artifact: PreparedDraftArtifact;
  readonly database: Database.Database;
  readonly extractedRoot: string;
  readonly importId: string;
  readonly layout: StorageLayout;
  readonly nowMs: number;
  readonly originalArchivePath: string;
}): Promise<FinalizedPreparedDraft> {
  const imports = new ImportRepository(input.database);
  const drafts = new DraftRepository(input.database);
  const jobs = new JobRepository(input.database);
  const imported = imports.require(input.importId);
  if (imported.state !== "preparing" || imported.bookId === null) {
    throw new Error("IMPORT_PREPARE_STATE_CONFLICT");
  }
  const reprocess = reprocessEvidence(imports, imported.id);
  const currentBook = reprocess ? drafts.requireBook(imported.bookId) : null;
  const currentConfigRecord =
    reprocess && currentBook?.draftConfigRevision
      ? drafts.requireConfig(imported.bookId, currentBook.draftConfigRevision)
      : null;
  if (
    reprocess &&
    (!currentBook ||
      !currentConfigRecord ||
      currentBook.draftSourceId !== reprocess.expectedSourceId ||
      currentBook.draftConfigRevision !== reprocess.expectedConfigRevision ||
      input.artifact.typography.profile !== reprocess.typographyProfile)
  ) {
    throw new Error("REPROCESS_PRECONDITION_FAILED");
  }
  const snapshot = await new SourceSnapshotService(
    input.database,
    input.layout,
  ).create({
    analysisVersion: draftPreparationVersion,
    bookId: imported.bookId,
    extractedRoot: input.extractedRoot,
    importId: imported.id,
    mainMarkdownRelativePath: input.artifact.mainMarkdownRelativePath,
    nowMs: input.nowMs,
    originalArchivePath: input.originalArchivePath,
    originalName: "mineru.zip",
  });
  const currentConfig =
    currentConfigRecord === null
      ? undefined
      : parseBookConfigYaml(
          await readFile(
            await resolveContainedPath(
              input.layout.root,
              currentConfigRecord.yamlRelativePath,
            ),
            "utf8",
          ),
        );
  const revision = reprocess ? reprocess.expectedConfigRevision + 1 : 1;
  const config = configFor({
    ...(currentConfig ? { baseConfig: currentConfig } : {}),
    bookId: imported.bookId,
    revision,
    snapshot,
    sourceRegions: input.artifact.sourceRegions,
    structure: input.artifact.structure,
    title: currentConfig ? String(currentConfig.title) : input.artifact.title,
    typography: input.artifact.typography,
  });
  const yaml = stringify(config, { lineWidth: 0 });
  const yamlSha256 = createHash("sha256").update(yaml).digest("hex");
  const yamlPath = resolve(
    input.layout.bookDirectory,
    String(imported.bookId),
    "draft",
    "configs",
    String(revision),
    "book.yaml",
  );
  await atomicWriteFile(yamlPath, yaml, { mode: 0o600 });
  await chmod(yamlPath, 0o400);
  const yamlRelativePath = relativePath(input.layout.root, yamlPath);
  const analysis = createPrintedContentsAnalysisV2({
    configRevision: revision,
    detection: preparedDetection(input.artifact),
    layoutDiagnostics: input.artifact.layoutDiagnostics,
    layoutSource: input.artifact.layoutSource,
    pdfDiagnostics: input.artifact.pdfDiagnostics,
    sourceId: snapshot.source.id,
    sourceSha256: snapshot.source.mainMarkdownSha256,
    typographyRiskSummaries: input.artifact.typographyRiskSummaries,
    typographyRiskSummariesTruncated:
      input.artifact.typographyRiskSummariesTruncated,
  });
  const analysisPath = resolve(
    input.layout.bookDirectory,
    String(imported.bookId),
    "draft",
    "analyses",
    snapshot.source.id,
    `${revision}.json`,
  );
  await atomicWriteFile(analysisPath, canonicalJson(analysis), { mode: 0o600 });
  await chmod(analysisPath, 0o400);
  let previewJob: JobRecord;
  if (reprocess && currentConfigRecord) {
    const replaced = drafts.replaceSourceConfigAndQueuePreview({
      bookId: imported.bookId,
      expectedRevision: reprocess.expectedConfigRevision,
      expectedSourceId: reprocess.expectedSourceId,
      expectedYamlSha256: currentConfigRecord.yamlSha256,
      importId: imported.id,
      newSourceId: snapshot.source.id,
      nowMs: input.nowMs,
      revision,
      schemaVersion: 3,
      title: String(config.title),
      yamlRelativePath,
      yamlSha256,
    });
    const queuedPreview = jobs.get(replaced.jobId);
    if (!queuedPreview) throw new Error("PREVIEW_JOB_NOT_FOUND");
    previewJob = queuedPreview;
  } else {
    drafts.addConfigRevision({
      bookId: imported.bookId,
      nowMs: input.nowMs,
      revision,
      schemaVersion: 3,
      sourceId: snapshot.source.id,
      title: input.artifact.title,
      yamlRelativePath,
      yamlSha256,
    });
    previewJob = jobs.create({
      bookId: imported.bookId,
      capturedConfigRevision: revision,
      capturedSourceId: snapshot.source.id,
      idempotency: {
        key: `preview-import-${imported.id}`,
        operation: "preview.build",
      },
      importId: imported.id,
      kind: "build_preview",
      nowMs: input.nowMs,
    });
    drafts.createPreview({
      bookId: imported.bookId,
      configRevision: revision,
      jobId: previewJob.id,
      sourceId: snapshot.source.id,
    });
  }
  imports.attachPreparedBook({
    bookId: imported.bookId,
    importId: imported.id,
    nowMs: input.nowMs,
  });
  return Object.freeze({
    bookId: imported.bookId,
    configRevision: revision,
    previewJob,
    snapshot,
  });
}

function preparedDetection(artifact: PreparedDraftArtifact) {
  const regions = new Map(
    artifact.sourceRegions.map((region) => [region.region_id, region] as const),
  );
  const candidates = artifact.printedContents.map((candidate) => {
    const proposedRegion = candidate.regionId
      ? regions.get(candidate.regionId)
      : undefined;
    return Object.freeze({
      alignment: candidate.alignment,
      boundaryConfidence: candidate.boundaryConfidence,
      canonical: candidate.canonical,
      confidence: candidate.confidence,
      diagnostics: candidate.diagnostics,
      endByte: candidate.endByte,
      entryCount: candidate.entryCount,
      logicalEntries: Object.freeze([]),
      matchedHeadingCount: candidate.matchedHeadingCount,
      matchConfidence: candidate.matchConfidence,
      ...(proposedRegion ? { proposedRegion } : {}),
      startByte: candidate.startByte,
    });
  });
  const canonicalRegionId = artifact.printedContents.find(
    (candidate) => candidate.canonical,
  )?.regionId;
  return Object.freeze({
    ...(canonicalRegionId ? { canonicalRegionId } : {}),
    candidates: Object.freeze(candidates),
  });
}

function relativePath(root: string, target: string): string {
  const relative = target
    .slice(root.length + 1)
    .split("\\")
    .join("/");
  if (!relative || target === root || !target.startsWith(`${root}/`)) {
    throw new Error("CONFIG_STORAGE_PATH_INVALID");
  }
  return relative;
}
