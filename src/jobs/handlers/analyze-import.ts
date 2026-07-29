import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  extractZipFile,
  type ArchiveExtractionLimits,
} from "@/compiler/archive/extractor";
import {
  discoverMarkdownCandidates,
  type CandidateDiscovery,
  type MarkdownCandidate,
} from "@/compiler/document/candidate-discovery";
import { ImportRepository, type ImportRecord } from "@/db/repositories/imports";
import { atomicWriteFile } from "@/storage/layout";
import {
  profilePipelineStage,
  recordPipelineProfileMetrics,
} from "@/observability/pipeline-profile";

export const importAnalysisVersion = "mineru-candidate-v1";
export const analysisArtifactFilename = "analysis-result.json";

export interface AnalyzeImportArtifact {
  readonly candidates: readonly MarkdownCandidate[];
  readonly decision: CandidateDiscovery["decision"];
  readonly reason: CandidateDiscovery["reason"];
  readonly selectedCandidateId: string | null;
  readonly version: typeof importAnalysisVersion;
}

export interface AnalyzeImportResult {
  readonly artifact: AnalyzeImportArtifact;
  readonly artifactPath: string;
  readonly entries: number;
  readonly files: number;
  readonly totalUncompressedBytes: number;
}

function rejectionCode(reason: CandidateDiscovery["reason"]): string {
  switch (reason) {
    case "ambiguous-candidates":
      return "IMPORT_AMBIGUOUS_CANDIDATES";
    case "missing-resources":
      return "IMPORT_RESOURCE_CLOSURE_FAILED";
    case "multiple-book-bundles":
      return "IMPORT_MULTIPLE_BOOKS";
    case "no-markdown":
      return "IMPORT_MAIN_MARKDOWN_MISSING";
    default:
      return "IMPORT_CANDIDATE_REJECTED";
  }
}

export async function analyzeImport(input: {
  readonly archivePath: string;
  readonly extractionLimits?: Partial<ArchiveExtractionLimits>;
  readonly signal?: AbortSignal;
  readonly stagingDirectory: string;
}): Promise<AnalyzeImportResult> {
  const stagingDirectory = resolve(input.stagingDirectory);
  const extractedDirectory = resolve(stagingDirectory, "extracted");
  const artifactPath = resolve(stagingDirectory, analysisArtifactFilename);
  try {
    await mkdir(dirname(stagingDirectory), { mode: 0o700, recursive: true });
    await mkdir(stagingDirectory, { mode: 0o700, recursive: false });
    const extracted = await profilePipelineStage("archive_extract", () =>
      extractZipFile({
        archivePath: input.archivePath,
        destination: extractedDirectory,
        ...(input.extractionLimits ? { limits: input.extractionLimits } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
    recordPipelineProfileMetrics({
      archive_entries: extracted.entries,
      archive_files: extracted.files,
      archive_uncompressed_bytes: extracted.totalUncompressedBytes,
    });
    const discovered = await profilePipelineStage("candidate_discovery", () =>
      discoverMarkdownCandidates(extractedDirectory),
    );
    recordPipelineProfileMetrics({
      markdown_candidates: discovered.candidates.length,
    });
    const artifact: AnalyzeImportArtifact = Object.freeze({
      candidates: discovered.candidates,
      decision: discovered.decision,
      reason: discovered.reason,
      selectedCandidateId: discovered.selectedCandidateId,
      version: importAnalysisVersion,
    });
    await profilePipelineStage("artifact_write", () =>
      atomicWriteFile(artifactPath, `${JSON.stringify(artifact)}\n`, {
        mode: 0o600,
      }),
    );
    return Object.freeze({
      artifact,
      artifactPath,
      entries: extracted.entries,
      files: extracted.files,
      totalUncompressedBytes: extracted.totalUncompressedBytes,
    });
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}

function isCandidate(value: unknown): value is MarkdownCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.normalizedPath === "string" &&
    typeof candidate.byteSize === "number" &&
    (candidate.confidence === "generic" || candidate.confidence === "high") &&
    typeof candidate.score === "number" &&
    (typeof candidate.firstHeading === "string" ||
      candidate.firstHeading === null) &&
    typeof candidate.referencedResources === "number" &&
    Array.isArray(candidate.companionFiles) &&
    Array.isArray(candidate.diagnostics)
  );
}

export async function readAnalyzeImportArtifact(
  artifactPath: string,
): Promise<AnalyzeImportArtifact> {
  if ((await stat(artifactPath)).size > 16 * 1024 * 1024) {
    throw new Error("IMPORT_ANALYSIS_ARTIFACT_INVALID");
  }
  const parsed: unknown = JSON.parse(await readFile(artifactPath, "utf8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("IMPORT_ANALYSIS_ARTIFACT_INVALID");
  }
  const artifact = parsed as Record<string, unknown>;
  if (
    artifact.version !== importAnalysisVersion ||
    !Array.isArray(artifact.candidates) ||
    !artifact.candidates.every(isCandidate) ||
    !["automatic", "confirmation", "reject"].includes(
      String(artifact.decision),
    ) ||
    ![
      "ambiguous-candidates",
      "cli-high-confidence",
      "cloud-high-confidence",
      "generic-single-markdown",
      "missing-resources",
      "multiple-book-bundles",
      "no-markdown",
    ].includes(String(artifact.reason)) ||
    (typeof artifact.selectedCandidateId !== "string" &&
      artifact.selectedCandidateId !== null)
  ) {
    throw new Error("IMPORT_ANALYSIS_ARTIFACT_INVALID");
  }
  const result = parsed as AnalyzeImportArtifact;
  const selectedExists =
    result.selectedCandidateId === null ||
    result.candidates.some(
      (candidate) => candidate.id === result.selectedCandidateId,
    );
  if (
    !selectedExists ||
    (result.decision === "automatic" && result.selectedCandidateId === null) ||
    (result.decision === "reject" && result.selectedCandidateId !== null)
  ) {
    throw new Error("IMPORT_ANALYSIS_ARTIFACT_INVALID");
  }
  return result;
}

export function persistAnalyzeImportArtifact(input: {
  readonly artifact: AnalyzeImportArtifact;
  readonly importId: string;
  readonly nowMs: number;
  readonly repository: ImportRepository;
}): ImportRecord {
  if (input.artifact.decision === "reject") {
    return input.repository.saveRejectedCandidates({
      candidates: input.artifact.candidates,
      errorCode: rejectionCode(input.artifact.reason),
      importId: input.importId,
      nowMs: input.nowMs,
    });
  }
  return input.repository.saveCandidates({
    candidates: input.artifact.candidates,
    importId: input.importId,
    nextState:
      input.artifact.decision === "automatic"
        ? "preparing"
        : "needs_main_confirmation",
    nowMs: input.nowMs,
    selectedCandidateId:
      input.artifact.decision === "automatic"
        ? input.artifact.selectedCandidateId
        : null,
  });
}
