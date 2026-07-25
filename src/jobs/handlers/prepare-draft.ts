import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import type Database from "better-sqlite3";
import { stringify } from "yaml";

import {
  extractZipFile,
  type ArchiveExtractionLimits,
} from "../../compiler/archive/extractor.js";
import { normalizeDocumentBlocks } from "../../compiler/document/normalize.js";
import { parseMarkdownDocument } from "../../compiler/document/parser.js";
import {
  detectPrintedContents,
  type PrintedContentsCandidate,
} from "../../compiler/document/printed-toc.js";
import { applySourceRegions } from "../../compiler/document/source-regions.js";
import {
  proposeDocumentStructure,
  type ProposedStructureNode,
} from "../../compiler/document/structure-proposal.js";
import type { ConfirmedSourceRegion } from "../../compiler/document/types.js";
import {
  preprocessMarkdownTypography,
  type TypographyProvenance,
} from "../../compiler/preprocess/typography.js";
import { inspectRasterImage } from "../../compiler/resources/images.js";
import { resolveDocumentResources } from "../../compiler/resources/resolver.js";
import { DraftRepository } from "../../db/repositories/drafts.js";
import {
  ImportRepository,
  type ReprocessPreparationEvidence,
} from "../../db/repositories/imports.js";
import { JobRepository, type JobRecord } from "../../db/repositories/jobs.js";
import {
  migrateBookConfigToCurrent,
  parseBookConfigYaml,
  validateBookConfig,
} from "../../schemas/book-config.js";
import { atomicWriteFile, resolveContainedPath } from "../../storage/layout.js";
import type { StorageLayout } from "../../storage/layout.js";
import {
  SourceSnapshotService,
  type SourceSnapshotResult,
} from "../../services/source-snapshot.js";

export const draftPreparationVersion = "prepare-draft-v2";
export const preparationArtifactFilename = "prepared-draft.json";

export interface PreparedDraftArtifact {
  readonly mainMarkdownRelativePath: string;
  readonly printedContents: readonly PreparedPrintedContentsSummary[];
  readonly sourceRegions: readonly ConfirmedSourceRegion[];
  readonly structure: readonly ProposedStructureNode[];
  readonly title: string;
  readonly typography: TypographyProvenance;
  readonly version: typeof draftPreparationVersion;
}

export interface PreparedPrintedContentsSummary {
  readonly confidence: PrintedContentsCandidate["confidence"];
  readonly diagnosticCodes: readonly string[];
  readonly endByte: number;
  readonly entryCount: number;
  readonly matchedHeadingCount: number;
  readonly regionId?: string;
  readonly startByte: number;
}

export interface PrepareDraftResult {
  readonly artifact: PreparedDraftArtifact;
  readonly artifactPath: string;
  readonly extractedRoot: string;
}

export interface FinalizedPreparedDraft {
  readonly bookId: number;
  readonly configRevision: number;
  readonly previewJob: JobRecord;
  readonly snapshot: SourceSnapshotResult;
}

export async function prepareDraft(input: {
  readonly archivePath: string;
  readonly extractionLimits?: Partial<ArchiveExtractionLimits>;
  readonly selectedCandidatePath: string;
  readonly signal?: AbortSignal;
  readonly stagingDirectory: string;
  readonly typographyProfile?: TypographyProvenance["profile"];
}): Promise<PrepareDraftResult> {
  const stagingDirectory = resolve(input.stagingDirectory);
  const extractedRoot = resolve(stagingDirectory, "extracted");
  const artifactPath = resolve(stagingDirectory, preparationArtifactFilename);
  try {
    await mkdir(dirname(stagingDirectory), { mode: 0o700, recursive: true });
    await mkdir(stagingDirectory, { mode: 0o700, recursive: false });
    const extracted = await extractZipFile({
      archivePath: input.archivePath,
      destination: extractedRoot,
      ...(input.extractionLimits ? { limits: input.extractionLimits } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (extracted.files < 1) throw new Error("IMPORT_ARCHIVE_EMPTY");
    const markdownPath = await resolveContainedPath(
      extractedRoot,
      input.selectedCandidatePath,
    );
    const markdownBytes = await readFile(markdownPath);
    const typography = preprocessMarkdownTypography(
      markdownBytes,
      input.typographyProfile ?? "zh-smart-v1",
    );
    await atomicWriteFile(markdownPath, typography.markdown, { mode: 0o600 });
    const document = parseMarkdownDocument(typography.markdown);
    const normalized = normalizeDocumentBlocks(document);
    const resources = await resolveDocumentResources({
      document,
      markdownPath,
      resourceRoot: dirname(markdownPath),
    });
    if (resources.diagnostics.length > 0) {
      throw new Error("IMPORT_RESOURCE_CLOSURE_FAILED");
    }
    for (const resource of resources.resources) {
      await inspectRasterImage({
        bytes: await readFile(resource.absolutePath),
        filename: resource.relativePath,
      });
    }
    const printedContents = detectPrintedContents({
      document: normalized,
      sourcePath: basename(input.selectedCandidatePath),
      sourceSha256: typography.provenance.output_sha256,
    });
    const sourceRegions = printedContents.candidates.flatMap((candidate) =>
      candidate.proposedRegion ? [candidate.proposedRegion] : [],
    );
    const proposal = proposeDocumentStructure(normalized, { sourceRegions });
    const activeDocument = applySourceRegions({
      document: normalized,
      mainMarkdownPath: basename(input.selectedCandidatePath),
      mainMarkdownSha256: typography.provenance.output_sha256,
      regions: sourceRegions,
    }).document;
    const artifact: PreparedDraftArtifact = Object.freeze({
      mainMarkdownRelativePath: input.selectedCandidatePath,
      printedContents: Object.freeze(
        printedContents.candidates.map((candidate) =>
          Object.freeze({
            confidence: candidate.confidence,
            diagnosticCodes: Object.freeze(
              candidate.diagnostics.map((diagnostic) => diagnostic.code),
            ),
            endByte: candidate.endByte,
            entryCount: candidate.entryCount,
            matchedHeadingCount: candidate.matchedHeadingCount,
            ...(candidate.proposedRegion
              ? { regionId: candidate.proposedRegion.region_id }
              : {}),
            startByte: candidate.startByte,
          }),
        ),
      ),
      sourceRegions,
      structure: proposal.nodes,
      title:
        activeDocument.headings[0]?.sourceTitle.trim().slice(0, 500) ||
        basename(input.selectedCandidatePath, ".md").slice(0, 500) ||
        "Untitled book",
      typography: typography.provenance,
      version: draftPreparationVersion,
    });
    await atomicWriteFile(artifactPath, `${JSON.stringify(artifact)}\n`, {
      mode: 0o600,
    });
    return Object.freeze({ artifact, artifactPath, extractedRoot });
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}

export async function readPreparedDraftArtifact(
  artifactPath: string,
): Promise<PreparedDraftArtifact> {
  if ((await stat(artifactPath)).size > 4 * 1024 * 1024) {
    throw new Error("PREPARED_DRAFT_ARTIFACT_INVALID");
  }
  const parsed: unknown = JSON.parse(await readFile(artifactPath, "utf8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("PREPARED_DRAFT_ARTIFACT_INVALID");
  }
  const artifact = parsed as Record<string, unknown>;
  if (
    artifact.version !== draftPreparationVersion ||
    typeof artifact.mainMarkdownRelativePath !== "string" ||
    typeof artifact.title !== "string" ||
    artifact.title.length < 1 ||
    artifact.title.length > 500 ||
    !validTypographyProvenance(artifact.typography) ||
    !Array.isArray(artifact.printedContents) ||
    !Array.isArray(artifact.sourceRegions) ||
    !Array.isArray(artifact.structure)
  ) {
    throw new Error("PREPARED_DRAFT_ARTIFACT_INVALID");
  }
  return parsed as PreparedDraftArtifact;
}

function validTypographyProvenance(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const provenance = value as Record<string, unknown>;
  return (
    (provenance.profile === "preserve-v1" ||
      provenance.profile === "zh-smart-v1") &&
    typeof provenance.input_sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(provenance.input_sha256) &&
    typeof provenance.output_sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(provenance.output_sha256) &&
    ["spaces_normalized", "punctuation_converted", "protected_nodes"].every(
      (key) =>
        Number.isInteger(provenance[key]) &&
        Number(provenance[key]) >= 0 &&
        Number(provenance[key]) <= 2_147_483_647,
    )
  );
}

export function preparedDraftArtifactPath(stagingDirectory: string): string {
  return resolve(stagingDirectory, preparationArtifactFilename);
}

function configFor(input: {
  readonly baseConfig?: Readonly<Record<string, unknown>>;
  readonly bookId: number;
  readonly revision: number;
  readonly snapshot: SourceSnapshotResult;
  readonly sourceRegions: readonly ConfirmedSourceRegion[];
  readonly structure: readonly ProposedStructureNode[];
  readonly title: string;
  readonly typography: TypographyProvenance;
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
    schema_version: 2,
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
      preprocessing: {
        typography: input.typography,
      },
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
    (evidence.typographyProfile !== "preserve-v1" &&
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
      : migrateBookConfigToCurrent(
          parseBookConfigYaml(
            await readFile(
              await resolveContainedPath(
                input.layout.root,
                currentConfigRecord.yamlRelativePath,
              ),
              "utf8",
            ),
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
      schemaVersion: 2,
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
      schemaVersion: 2,
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
