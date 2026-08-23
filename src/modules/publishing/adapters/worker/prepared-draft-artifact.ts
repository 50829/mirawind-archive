import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { LayoutEvidenceDiagnostic } from "../../core/preparation/layout-evidence";
import type { PdfContentsEvidenceDiagnostic } from "../filesystem/read-pdf-contents-evidence";
import type { PrintedContentsCandidate } from "../../core/preparation/printed-contents";
import type { ProposedStructureNode } from "../../core/preparation/structure-proposal";
import type { ProposedStructureBoundaries } from "../../core/preparation/structure-proposal";
import type { ConfirmedSourceRegion } from "../../core/preparation/document-model";
import type { ContentCleanupProvenance } from "../../core/preparation/prepared-document";
import type { PdfSourceDiagnostic } from "../../core/preparation/pdf-evidence-model";
import type {
  TypographyProvenance,
  TypographyRiskSummary,
} from "../../core/preparation/typography";

export const draftPreparationVersion = "prepare-draft-v5";
export const preparationArtifactFilename = "prepared-draft.json";
export const preparedSourceFilesFilename = "prepared-source-files.json";

export interface PreparedDraftArtifact {
  readonly analysisSourceSha256: string;
  readonly boundaries: ProposedStructureBoundaries;
  readonly contentCleanup: ContentCleanupProvenance;
  readonly layoutDiagnostics: readonly LayoutEvidenceDiagnostic[];
  readonly layoutSource: "content-list" | "native-pdf" | "none" | "ocr";
  readonly mainMarkdownRelativePath: string;
  readonly pdfDiagnostics: readonly PreparedPdfDiagnostic[];
  readonly printedContents: readonly PreparedPrintedContentsSummary[];
  readonly sourceRegions: readonly ConfirmedSourceRegion[];
  readonly sourceBlocks: readonly PreparedSourceBlock[];
  readonly structure: readonly ProposedStructureNode[];
  readonly metadata: Readonly<{ readonly title: string }>;
  readonly typography: TypographyProvenance;
  readonly typographyRiskSummaries: readonly TypographyRiskSummary[];
  readonly typographyRiskSummariesTruncated: boolean;
  readonly version: typeof draftPreparationVersion;
}

export interface PreparedSourceBlock {
  readonly block_id: string;
  readonly end_offset: number;
  readonly kind: string;
  readonly start_offset: number;
  readonly text_fingerprint: string;
}

export interface PreparedPrintedContentsSummary {
  readonly alignment: PrintedContentsCandidate["alignment"];
  readonly boundaryConfidence: PrintedContentsCandidate["boundaryConfidence"];
  readonly canonical: boolean;
  readonly confidence: PrintedContentsCandidate["confidence"];
  readonly diagnostics: PrintedContentsCandidate["diagnostics"];
  readonly endByte: number;
  readonly entryCount: number;
  readonly matchedHeadingCount: number;
  readonly matchConfidence: PrintedContentsCandidate["matchConfidence"];
  readonly regionId?: string;
  readonly startByte: number;
}

export interface PreparedPdfDiagnostic {
  readonly code: PdfContentsEvidenceDiagnostic["code"] | PdfSourceDiagnostic;
  readonly pageIndex?: number;
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
    !validSha256(artifact.analysisSourceSha256) ||
    !validMetadata(artifact.metadata) ||
    !validContentCleanup(artifact.contentCleanup) ||
    !validBoundaries(artifact.boundaries) ||
    !validTypographyProvenance(artifact.typography) ||
    !Array.isArray(artifact.layoutDiagnostics) ||
    !["content-list", "native-pdf", "none", "ocr"].includes(
      String(artifact.layoutSource),
    ) ||
    !Array.isArray(artifact.pdfDiagnostics) ||
    !Array.isArray(artifact.printedContents) ||
    !Array.isArray(artifact.sourceRegions) ||
    !validSourceBlocks(artifact.sourceBlocks) ||
    !Array.isArray(artifact.structure) ||
    !Array.isArray(artifact.typographyRiskSummaries) ||
    typeof artifact.typographyRiskSummariesTruncated !== "boolean"
  ) {
    throw new Error("PREPARED_DRAFT_ARTIFACT_INVALID");
  }
  return parsed as PreparedDraftArtifact;
}

function validSourceRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    Buffer.byteLength(value, "utf8") > 2_048 ||
    value !== value.normalize("NFC") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/")
  ) {
    return false;
  }
  return value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
}

export function createPreparedSourceFiles(
  paths: readonly string[],
): readonly string[] {
  if (
    paths.length > 20_000 ||
    paths.some((path) => !validSourceRelativePath(path))
  ) {
    throw new Error("PREPARED_SOURCE_FILES_INVALID");
  }
  const sorted = [...paths].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
  if (sorted.some((path, index) => index > 0 && path === sorted[index - 1])) {
    throw new Error("PREPARED_SOURCE_FILES_INVALID");
  }
  return Object.freeze(sorted);
}

export async function readPreparedSourceFiles(
  sourceFilesPath: string,
): Promise<readonly string[]> {
  if ((await stat(sourceFilesPath)).size > 42 * 1024 * 1024) {
    throw new Error("PREPARED_SOURCE_FILES_INVALID");
  }
  const parsed: unknown = JSON.parse(await readFile(sourceFilesPath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("PREPARED_SOURCE_FILES_INVALID");
  }
  return createPreparedSourceFiles(parsed);
}

function validTypographyProvenance(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const provenance = value as Record<string, unknown>;
  return (
    (provenance.profile === "verbatim-v1" ||
      provenance.profile === "zh-smart-v2") &&
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

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validMetadata(value: unknown): boolean {
  const metadata = record(value);
  return Boolean(
    metadata &&
    Object.keys(metadata).length === 1 &&
    typeof metadata.title === "string" &&
    metadata.title.length >= 1 &&
    metadata.title.length <= 500,
  );
}

function validContentCleanup(value: unknown): boolean {
  const cleanup = record(value);
  return Boolean(
    cleanup &&
    validSha256(cleanup.input_sha256) &&
    validSha256(cleanup.output_sha256) &&
    ["printed_toc_regions_removed", "helper_blocks_removed"].every(
      (key) =>
        Number.isSafeInteger(cleanup[key]) &&
        Number(cleanup[key]) >= 0 &&
        Number(cleanup[key]) <= 2_147_483_647,
    ),
  );
}

function validBoundaries(value: unknown): boolean {
  const boundaries = record(value);
  if (!boundaries || typeof boundaries.body_start_block_id !== "string") {
    return false;
  }
  return ["appendix_start_block_id", "backmatter_start_block_id"].every(
    (key) =>
      boundaries[key] === undefined || typeof boundaries[key] === "string",
  );
}

function validSourceBlocks(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20_000) {
    return false;
  }
  return value.every((item) => {
    const block = record(item);
    return Boolean(
      block &&
      typeof block.block_id === "string" &&
      typeof block.kind === "string" &&
      Number.isSafeInteger(block.start_offset) &&
      Number.isSafeInteger(block.end_offset) &&
      Number(block.start_offset) >= 0 &&
      Number(block.end_offset) > Number(block.start_offset) &&
      typeof block.text_fingerprint === "string",
    );
  });
}

export function preparedDraftArtifactPath(stagingDirectory: string): string {
  return resolve(stagingDirectory, preparationArtifactFilename);
}
