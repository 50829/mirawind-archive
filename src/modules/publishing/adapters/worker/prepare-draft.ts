import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  extractZipFile,
  type ArchiveExtractionLimits,
} from "@/modules/publishing/adapters/filesystem/extract-archive";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import { readPdfContentsEvidence } from "@/modules/publishing/adapters/filesystem/read-pdf-contents-evidence";
import {
  preprocessMarkdownTypography,
  type TypographyProvenance,
} from "@/modules/publishing/core/preparation/typography";
import { resolveDocumentResources } from "@/modules/publishing/adapters/filesystem/resolve-document-resources";
import { claimSealedExtraction } from "@/modules/publishing/adapters/filesystem/sealed-extraction";
import { analyzeDraftContents } from "@/modules/publishing/adapters/worker/draft-contents-analysis";
import {
  createPreparedSourceFiles,
  draftPreparationVersion,
  type PreparedDraftArtifact,
  preparationArtifactFilename,
  preparedSourceFilesFilename,
} from "@/modules/publishing/adapters/worker/prepared-draft-artifact";
import {
  atomicWriteFile,
  resolveContainedPath,
} from "@/platform/filesystem/layout";
import {
  profilePipelineStage,
  recordPipelineProfileMetrics,
} from "@/observability/pipeline-profile";

export interface PrepareDraftResult {
  readonly artifact: PreparedDraftArtifact;
  readonly artifactPath: string;
  readonly extractionSource: "archive" | "sealed";
  readonly extractedRoot: string;
  readonly sourceFiles: readonly string[];
  readonly sourceFilesPath: string;
}

export async function prepareDraft(input: {
  readonly archivePath: string;
  readonly extractionLimits?: Partial<ArchiveExtractionLimits>;
  readonly importId?: string;
  readonly selectedCandidatePath: string;
  readonly sealedExtractionDirectory?: string;
  readonly signal?: AbortSignal;
  readonly stagingDirectory: string;
  readonly typographyProfile?: TypographyProvenance["profile"];
  readonly pdfEvidenceReader?: typeof readPdfContentsEvidence;
}): Promise<PrepareDraftResult> {
  if (Boolean(input.importId) !== Boolean(input.sealedExtractionDirectory)) {
    throw new Error("SEALED_EXTRACTION_INPUT_INVALID");
  }
  const stagingDirectory = resolve(input.stagingDirectory);
  const extractedRoot = resolve(stagingDirectory, "extracted");
  const artifactPath = resolve(stagingDirectory, preparationArtifactFilename);
  const sourceFilesPath = resolve(
    stagingDirectory,
    preparedSourceFilesFilename,
  );
  try {
    await mkdir(dirname(stagingDirectory), { mode: 0o700, recursive: true });
    await mkdir(stagingDirectory, { mode: 0o700, recursive: false });
    const claimed =
      input.importId && input.sealedExtractionDirectory
        ? await claimSealedExtraction({
            expectedImportId: input.importId,
            sealedDirectory: input.sealedExtractionDirectory,
            stagingDirectory,
          })
        : null;
    if (input.signal?.aborted) throw new Error("ARCHIVE_CANCELED");
    const extractionSource = claimed ? "sealed" : "archive";
    const extracted =
      claimed ??
      (await profilePipelineStage("archive_extract", () =>
        extractZipFile({
          archivePath: input.archivePath,
          destination: extractedRoot,
          ...(input.extractionLimits ? { limits: input.extractionLimits } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        }),
      ));
    recordPipelineProfileMetrics({
      archive_entries: extracted.entries,
      archive_files: extracted.files,
      archive_reused: extractionSource === "sealed" ? 1 : 0,
      archive_uncompressed_bytes: extracted.totalUncompressedBytes,
    });
    if (extracted.files < 1) throw new Error("IMPORT_ARCHIVE_EMPTY");
    const markdownPath = await resolveContainedPath(
      extractedRoot,
      input.selectedCandidatePath,
    );
    const markdownBytes = await profilePipelineStage("markdown_read", () =>
      readFile(markdownPath),
    );
    recordPipelineProfileMetrics({ markdown_bytes: markdownBytes.byteLength });
    const typography = await profilePipelineStage("typography", async () => {
      const result = preprocessMarkdownTypography(
        markdownBytes,
        input.typographyProfile ?? "zh-smart-v2",
      );
      await atomicWriteFile(markdownPath, result.markdown, { mode: 0o600 });
      return result;
    });
    recordPipelineProfileMetrics({
      protected_nodes: typography.provenance.protected_nodes,
    });
    const normalized = await profilePipelineStage("parse_normalize", () => {
      const parsed = parseMarkdownDocument(typography.markdown);
      return normalizeDocumentBlocks(parsed);
    });
    recordPipelineProfileMetrics({
      headings: normalized.headings.length,
      root_blocks: normalized.blocks.length,
    });
    const contents = await analyzeDraftContents({
      markdownPath,
      normalized,
      ...(input.pdfEvidenceReader
        ? { pdfEvidenceReader: input.pdfEvidenceReader }
        : {}),
      selectedCandidatePath: input.selectedCandidatePath,
      ...(input.signal ? { signal: input.signal } : {}),
      sourceSha256: typography.provenance.output_sha256,
      stagingDirectory,
    });
    await atomicWriteFile(
      markdownPath,
      contents.preparedDocument.activeMarkdown,
      {
        mode: 0o600,
      },
    );
    recordPipelineProfileMetrics({
      cleanup_helper_blocks_removed:
        contents.contentCleanup.helper_blocks_removed,
      cleanup_printed_toc_regions_removed:
        contents.contentCleanup.printed_toc_regions_removed,
    });
    const resources = await profilePipelineStage("resource_resolution", () =>
      resolveDocumentResources({
        document: contents.preparedDocument.active,
        markdownPath,
        resourceRoot: dirname(markdownPath),
      }),
    );
    if (resources.diagnostics.length > 0) {
      throw new Error("IMPORT_RESOURCE_CLOSURE_FAILED");
    }
    recordPipelineProfileMetrics({
      resources: resources.resources.length,
    });
    const { preparedDocument: _preparedDocument, ...artifactContents } =
      contents;
    void _preparedDocument;
    const artifact: PreparedDraftArtifact = Object.freeze({
      ...artifactContents,
      mainMarkdownRelativePath: input.selectedCandidatePath,
      typography: typography.provenance,
      typographyRiskSummaries: typography.riskSummaries,
      typographyRiskSummariesTruncated: typography.riskSummariesTruncated,
      version: draftPreparationVersion,
    });
    const sourceFiles = createPreparedSourceFiles(
      resources.resources.map((resource) => resource.relativePath),
    );
    await profilePipelineStage("artifact_write", () =>
      Promise.all([
        atomicWriteFile(artifactPath, `${JSON.stringify(artifact)}\n`, {
          mode: 0o600,
        }),
        atomicWriteFile(sourceFilesPath, `${JSON.stringify(sourceFiles)}\n`, {
          mode: 0o600,
        }),
      ]),
    );
    return Object.freeze({
      artifact,
      artifactPath,
      extractedRoot,
      extractionSource,
      sourceFiles,
      sourceFilesPath,
    });
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}
