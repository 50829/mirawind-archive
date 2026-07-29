import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { LayoutEvidenceDiagnostic } from "@/modules/publishing/core/preparation/layout-evidence";
import type { PdfContentsEvidenceDiagnostic } from "@/modules/publishing/adapters/filesystem/read-pdf-contents-evidence";
import type { PdfSourceDiagnostic } from "@/modules/publishing/adapters/filesystem/find-original-pdf";
import type { PrintedContentsCandidate } from "@/modules/publishing/core/preparation/printed-contents";
import type { ProposedStructureNode } from "@/modules/publishing/core/preparation/structure-proposal";
import type { ConfirmedSourceRegion } from "@/modules/publishing/core/preparation/document-model";
import type {
  TypographyProvenance,
  TypographyRiskSummary,
} from "@/modules/publishing/core/preparation/typography";

export const draftPreparationVersion = "prepare-draft-v4";
export const preparationArtifactFilename = "prepared-draft.json";

export interface PreparedDraftArtifact {
  readonly layoutDiagnostics: readonly LayoutEvidenceDiagnostic[];
  readonly layoutSource: "content-list" | "native-pdf" | "none" | "ocr";
  readonly mainMarkdownRelativePath: string;
  readonly pdfDiagnostics: readonly PreparedPdfDiagnostic[];
  readonly printedContents: readonly PreparedPrintedContentsSummary[];
  readonly sourceRegions: readonly ConfirmedSourceRegion[];
  readonly structure: readonly ProposedStructureNode[];
  readonly title: string;
  readonly typography: TypographyProvenance;
  readonly typographyRiskSummaries: readonly TypographyRiskSummary[];
  readonly typographyRiskSummariesTruncated: boolean;
  readonly version: typeof draftPreparationVersion;
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
    typeof artifact.title !== "string" ||
    artifact.title.length < 1 ||
    artifact.title.length > 500 ||
    !validTypographyProvenance(artifact.typography) ||
    !Array.isArray(artifact.layoutDiagnostics) ||
    !["content-list", "native-pdf", "none", "ocr"].includes(
      String(artifact.layoutSource),
    ) ||
    !Array.isArray(artifact.pdfDiagnostics) ||
    !Array.isArray(artifact.printedContents) ||
    !Array.isArray(artifact.sourceRegions) ||
    !Array.isArray(artifact.structure) ||
    !Array.isArray(artifact.typographyRiskSummaries) ||
    typeof artifact.typographyRiskSummariesTruncated !== "boolean"
  ) {
    throw new Error("PREPARED_DRAFT_ARTIFACT_INVALID");
  }
  return parsed as PreparedDraftArtifact;
}

function validTypographyProvenance(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const provenance = value as Record<string, unknown>;
  return (
    (provenance.profile === "verbatim-v1" ||
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
