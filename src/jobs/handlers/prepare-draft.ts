import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  extractZipFile,
  type ArchiveExtractionLimits,
} from "@/compiler/archive/extractor";
import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import { readPdfContentsEvidence } from "@/compiler/document/pdf-contents-evidence";
import {
  preprocessMarkdownTypography,
  type TypographyProvenance,
} from "@/compiler/preprocess/typography";
import { inspectRasterImage } from "@/compiler/resources/images";
import { resolveDocumentResources } from "@/compiler/resources/resolver";
import { analyzeDraftContents } from "@/jobs/handlers/draft-contents-analysis";
import {
  draftPreparationVersion,
  type PreparedDraftArtifact,
  preparationArtifactFilename,
} from "@/jobs/handlers/prepared-draft-artifact";
import { atomicWriteFile, resolveContainedPath } from "@/storage/layout";
import {
  profilePipelineStage,
  recordPipelineProfileMetrics,
} from "@/observability/pipeline-profile";

export interface PrepareDraftResult {
  readonly artifact: PreparedDraftArtifact;
  readonly artifactPath: string;
  readonly extractedRoot: string;
}

export async function prepareDraft(input: {
  readonly archivePath: string;
  readonly extractionLimits?: Partial<ArchiveExtractionLimits>;
  readonly selectedCandidatePath: string;
  readonly signal?: AbortSignal;
  readonly stagingDirectory: string;
  readonly typographyProfile?: TypographyProvenance["profile"];
  readonly pdfEvidenceReader?: typeof readPdfContentsEvidence;
}): Promise<PrepareDraftResult> {
  const stagingDirectory = resolve(input.stagingDirectory);
  const extractedRoot = resolve(stagingDirectory, "extracted");
  const artifactPath = resolve(stagingDirectory, preparationArtifactFilename);
  try {
    await mkdir(dirname(stagingDirectory), { mode: 0o700, recursive: true });
    await mkdir(stagingDirectory, { mode: 0o700, recursive: false });
    const extracted = await profilePipelineStage("archive_extract", () =>
      extractZipFile({
        archivePath: input.archivePath,
        destination: extractedRoot,
        ...(input.extractionLimits ? { limits: input.extractionLimits } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
    recordPipelineProfileMetrics({
      archive_entries: extracted.entries,
      archive_files: extracted.files,
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
        input.typographyProfile ?? "zh-smart-v1",
      );
      await atomicWriteFile(markdownPath, result.markdown, { mode: 0o600 });
      return result;
    });
    recordPipelineProfileMetrics({
      protected_nodes: typography.provenance.protected_nodes,
    });
    const { document, normalized } = await profilePipelineStage(
      "parse_normalize",
      () => {
        const parsed = parseMarkdownDocument(typography.markdown);
        return {
          document: parsed,
          normalized: normalizeDocumentBlocks(parsed),
        };
      },
    );
    recordPipelineProfileMetrics({
      headings: normalized.headings.length,
      root_blocks: normalized.blocks.length,
    });
    const resources = await profilePipelineStage("resource_resolution", () =>
      resolveDocumentResources({
        document,
        markdownPath,
        resourceRoot: dirname(markdownPath),
      }),
    );
    if (resources.diagnostics.length > 0) {
      throw new Error("IMPORT_RESOURCE_CLOSURE_FAILED");
    }
    let resourceBytes = 0;
    await profilePipelineStage("image_inspection", async () => {
      for (const resource of resources.resources) {
        const bytes = await readFile(resource.absolutePath);
        resourceBytes += bytes.byteLength;
        await inspectRasterImage({
          bytes,
          filename: resource.relativePath,
        });
      }
    });
    recordPipelineProfileMetrics({
      resource_bytes: resourceBytes,
      resources: resources.resources.length,
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
    const artifact: PreparedDraftArtifact = Object.freeze({
      ...contents,
      mainMarkdownRelativePath: input.selectedCandidatePath,
      typography: typography.provenance,
      typographyRiskSummaries: typography.riskSummaries,
      typographyRiskSummariesTruncated: typography.riskSummariesTruncated,
      version: draftPreparationVersion,
    });
    await profilePipelineStage("artifact_write", () =>
      atomicWriteFile(artifactPath, `${JSON.stringify(artifact)}\n`, {
        mode: 0o600,
      }),
    );
    return Object.freeze({ artifact, artifactPath, extractedRoot });
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}
