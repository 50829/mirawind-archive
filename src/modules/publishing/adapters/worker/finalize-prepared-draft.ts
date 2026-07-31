import { createHash } from "node:crypto";
import { chmod, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";
import { stringify } from "yaml";

import { canonicalJson } from "@/modules/publishing/core/publication/manifest";
import { createPrintedContentsAnalysisV2 } from "@/modules/publishing/core/preparation/printed-contents-analysis";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import {
  DraftCandidateRepository,
  type DraftCandidateRecord,
} from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import {
  ImportRepository,
  type ReprocessPreparationEvidence,
} from "@/modules/publishing/adapters/sqlite/imports";
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
  readonly candidate: DraftCandidateRecord;
  readonly configRevision: number;
  readonly snapshot: SourceSnapshotResult;
}

function configFor(input: {
  readonly baseConfig?: Readonly<Record<string, unknown>>;
  readonly boundaries: PreparedDraftArtifact["boundaries"];
  readonly bookId: number;
  readonly contentCleanup: PreparedDraftArtifact["contentCleanup"];
  readonly metadata: PreparedDraftArtifact["metadata"];
  readonly revision: number;
  readonly snapshot: SourceSnapshotResult;
  readonly sourceBlocks: PreparedDraftArtifact["sourceBlocks"];
  readonly structure: PreparedDraftArtifact["structure"];
  readonly typography: PreparedDraftArtifact["typography"];
}): Readonly<Record<string, unknown>> {
  if (
    input.typography.output_sha256 !== input.contentCleanup.input_sha256 ||
    input.contentCleanup.output_sha256 !==
      input.snapshot.source.mainMarkdownSha256
  ) {
    throw new Error("PREPROCESS_OUTPUT_HASH_MISMATCH");
  }
  return validateBookConfig({
    ...(input.baseConfig?.alias ? { alias: input.baseConfig.alias } : {}),
    boundaries: input.boundaries,
    book_id: input.bookId,
    metadata: input.baseConfig?.metadata ?? input.metadata,
    publishing: input.baseConfig?.publishing ?? {
      code: { line_numbers: false },
      numbering: { mode: "source" },
    },
    revision: input.revision,
    schema_version: 4,
    source: {
      blocks: input.sourceBlocks,
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
      preprocessing: {
        content_cleanup: input.contentCleanup,
        typography: input.typography,
      },
    },
    structure: input.structure,
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
      evidence.typographyProfile !== "zh-smart-v2")
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
  readonly resourceRelativePaths: readonly string[];
}): Promise<FinalizedPreparedDraft> {
  const imports = new ImportRepository(input.database);
  const drafts = new DraftRepository(input.database);
  const candidates = new DraftCandidateRepository(input.database);
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
    originalName: imported.originalName,
    resourceRelativePaths: input.resourceRelativePaths,
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
    boundaries: input.artifact.boundaries,
    bookId: imported.bookId,
    contentCleanup: input.artifact.contentCleanup,
    metadata: input.artifact.metadata,
    revision,
    snapshot,
    sourceBlocks: input.artifact.sourceBlocks,
    structure: input.artifact.structure,
    typography: input.artifact.typography,
  });
  const configMetadata = config.metadata as Readonly<Record<string, unknown>>;
  const title = String(configMetadata.title);
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
    sourceSha256: input.artifact.analysisSourceSha256,
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
  let candidate: DraftCandidateRecord;
  if (reprocess && currentConfigRecord) {
    candidate = candidates.replaceSourceConfigAndCreate({
      bookId: imported.bookId,
      expectedRevision: reprocess.expectedConfigRevision,
      expectedSourceId: reprocess.expectedSourceId,
      expectedYamlSha256: currentConfigRecord.yamlSha256,
      importId: imported.id,
      newSourceId: snapshot.source.id,
      nowMs: input.nowMs,
      revision,
      schemaVersion: 4,
      title,
      yamlRelativePath,
      yamlSha256,
    });
  } else {
    candidate = candidates.addInitialConfigAndCreate({
      bookId: imported.bookId,
      importId: imported.id,
      nowMs: input.nowMs,
      revision,
      schemaVersion: 4,
      sourceId: snapshot.source.id,
      title,
      yamlRelativePath,
      yamlSha256,
    });
  }
  imports.attachPreparedBook({
    bookId: imported.bookId,
    importId: imported.id,
    nowMs: input.nowMs,
  });
  return Object.freeze({
    bookId: imported.bookId,
    candidate,
    configRevision: revision,
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
