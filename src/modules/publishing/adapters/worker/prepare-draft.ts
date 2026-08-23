import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  extractZipFile,
  type ArchiveExtractionLimits,
} from "../filesystem/extract-archive";
import { normalizeDocumentBlocks } from "../../core/preparation/normalize-document";
import { normalizeMineruPreformattedMarkdown } from "../../core/preparation/mineru-preformatted";
import { parseMarkdownDocument } from "../../core/preparation/parse-markdown";
import {
  preprocessMarkdownTypography,
  type TypographyProvenance,
} from "../../core/preparation/typography";
import { resolveDocumentResources } from "../filesystem/resolve-document-resources";
import { claimSealedExtraction } from "../filesystem/sealed-extraction";
import {
  analyzeDraftContents,
  type PdfEvidenceReader,
} from "./draft-contents-analysis";
import {
  createPreparedSourceFiles,
  draftPreparationVersion,
  type PreparedDraftArtifact,
  preparationArtifactFilename,
  preparedSourceFilesFilename,
} from "./prepared-draft-artifact";
import { resolveContainedPath } from "@/platform/filesystem/contained-path";
import { atomicWriteFile } from "@/platform/filesystem/atomic-file";
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
  readonly pdfEvidenceReader?: PdfEvidenceReader;
  readonly onPhase?: (
    phase: "identify_document" | "organize_structure" | "security_check",
    completed: number,
    total: number,
  ) => void;
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
    input.onPhase?.("security_check", 0, 3);
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
    input.onPhase?.("identify_document", 1, 3);
    const markdownPath = await resolveContainedPath(
      extractedRoot,
      input.selectedCandidatePath,
    );
    const markdownBytes = await profilePipelineStage("markdown_read", () =>
      readFile(markdownPath),
    );
    recordPipelineProfileMetrics({ markdown_bytes: markdownBytes.byteLength });
    input.onPhase?.("organize_structure", 2, 3);
    const typography = await profilePipelineStage("typography", () =>
      preprocessMarkdownTypography(
        markdownBytes,
        input.typographyProfile ?? "zh-smart-v2",
      ),
    );
    recordPipelineProfileMetrics({
      protected_nodes: typography.provenance.protected_nodes,
    });
    const analysisMarkdown = await profilePipelineStage(
      "structural_cleanup",
      async () => {
        const markdown = normalizeMineruPreformattedMarkdown(
          typography.markdown,
        );
        await atomicWriteFile(markdownPath, markdown, { mode: 0o600 });
        return markdown;
      },
    );
    const normalized = await profilePipelineStage("parse_normalize", () => {
      const parsed = parseMarkdownDocument(analysisMarkdown);
      return normalizeDocumentBlocks(parsed);
    });
    recordPipelineProfileMetrics({
      headings: normalized.headings.length,
      root_blocks: normalized.blocks.length,
    });
    const contents = await analyzeDraftContents({
      cleanupInputSha256: typography.provenance.output_sha256,
      markdownPath,
      normalized,
      ...(input.pdfEvidenceReader
        ? { pdfEvidenceReader: input.pdfEvidenceReader }
        : {}),
      selectedCandidatePath: input.selectedCandidatePath,
      ...(input.signal ? { signal: input.signal } : {}),
      sourceSha256: createHash("sha256").update(analysisMarkdown).digest("hex"),
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
    input.onPhase?.("organize_structure", 3, 3);
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
