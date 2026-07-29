import { isOpaqueId } from "@/domain/ids";
import type { LayoutEvidenceDiagnostic } from "@/compiler/document/layout-evidence";
import type { PdfContentsEvidenceDiagnostic } from "@/compiler/document/pdf-contents-evidence";
import type { PdfSourceDiagnostic } from "@/compiler/document/pdf-source";
import type { PrintedContentsDetection } from "@/compiler/document/printed-toc";
import type { TypographyRiskSummary } from "@/compiler/preprocess/typography";

export const printedContentsAnalysisIdentity =
  "printed-contents-analysis-v2" as const;

export interface PrintedContentsAnalysisV2 {
  readonly candidates: readonly {
    readonly alignment: {
      readonly best_score: number;
      readonly margin: number;
      readonly second_best_score: number;
    };
    readonly boundary_confidence: "high" | "low" | "medium";
    readonly canonical: boolean;
    readonly diagnostics: readonly {
      readonly block_id: string | null;
      readonly code: string;
      readonly path: string;
    }[];
    readonly end_byte: number;
    readonly entries: readonly {
      readonly body_heading_block_id: string | null;
      readonly end_byte: number;
      readonly reference_level: number;
      readonly start_byte: number;
    }[];
    readonly match_confidence: "high" | "low" | "medium";
    readonly region_id: string | null;
    readonly start_byte: number;
  }[];
  readonly canonical_region_id: string | null;
  readonly config_revision: number;
  readonly evidence_diagnostics: readonly {
    readonly code: LayoutEvidenceDiagnostic["code"];
  }[];
  readonly identity: typeof printedContentsAnalysisIdentity;
  readonly layout_source: "content-list" | "native-pdf" | "none" | "ocr";
  readonly pdf_diagnostics: readonly {
    readonly code: PdfContentsEvidenceDiagnostic["code"] | PdfSourceDiagnostic;
    readonly page_index: number | null;
  }[];
  readonly source_id: string;
  readonly source_sha256: string;
  readonly typography: {
    readonly risk_summaries: readonly TypographyRiskSummary[];
    readonly truncated: boolean;
  };
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function boundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

function byteRange(start: unknown, end: unknown): boolean {
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    Number(start) >= 0 &&
    Number(end) > Number(start)
  );
}

function validRisk(value: unknown): boolean {
  const item = record(value);
  return Boolean(
    item &&
    exactKeys(item, [
      "code",
      "end_byte",
      "punctuation_converted",
      "spaces_normalized",
      "start_byte",
    ]) &&
    [
      "TYPOGRAPHY_MIXED_REWRITE",
      "TYPOGRAPHY_PUNCTUATION_REWRITE",
      "TYPOGRAPHY_SPACING_REWRITE",
    ].includes(String(item.code)) &&
    byteRange(item.start_byte, item.end_byte) &&
    Number.isSafeInteger(item.punctuation_converted) &&
    Number(item.punctuation_converted) >= 0 &&
    Number.isSafeInteger(item.spaces_normalized) &&
    Number(item.spaces_normalized) >= 0,
  );
}

export function createPrintedContentsAnalysisV2(input: {
  readonly configRevision: number;
  readonly detection: PrintedContentsDetection;
  readonly layoutDiagnostics: readonly LayoutEvidenceDiagnostic[];
  readonly layoutSource: PrintedContentsAnalysisV2["layout_source"];
  readonly pdfDiagnostics: readonly {
    readonly code: PdfContentsEvidenceDiagnostic["code"] | PdfSourceDiagnostic;
    readonly pageIndex?: number;
  }[];
  readonly sourceId: string;
  readonly sourceSha256: string;
  readonly typographyRiskSummaries: readonly TypographyRiskSummary[];
  readonly typographyRiskSummariesTruncated: boolean;
}): PrintedContentsAnalysisV2 {
  const value: PrintedContentsAnalysisV2 = Object.freeze({
    candidates: Object.freeze(
      input.detection.candidates.slice(0, 100).map((candidate) =>
        Object.freeze({
          alignment: Object.freeze({
            best_score: candidate.alignment.bestScore,
            margin: candidate.alignment.margin,
            second_best_score: candidate.alignment.secondBestScore,
          }),
          boundary_confidence: candidate.boundaryConfidence,
          canonical: candidate.canonical,
          diagnostics: Object.freeze(
            candidate.diagnostics.slice(0, 100).map((diagnostic) =>
              Object.freeze({
                block_id: diagnostic.blockId ?? null,
                code: diagnostic.code,
                path: diagnostic.path,
              }),
            ),
          ),
          end_byte: candidate.endByte,
          entries: Object.freeze(
            (candidate.proposedRegion?.entries ?? []).map((entry) =>
              Object.freeze({
                body_heading_block_id: entry.body_heading_block_id ?? null,
                end_byte: entry.range.end_byte,
                reference_level: entry.reference_level,
                start_byte: entry.range.start_byte,
              }),
            ),
          ),
          match_confidence: candidate.matchConfidence,
          region_id: candidate.proposedRegion?.region_id ?? null,
          start_byte: candidate.startByte,
        }),
      ),
    ),
    canonical_region_id: input.detection.canonicalRegionId ?? null,
    config_revision: input.configRevision,
    evidence_diagnostics: Object.freeze(
      input.layoutDiagnostics.slice(0, 100).map((diagnostic) =>
        Object.freeze({
          code: diagnostic.code,
        }),
      ),
    ),
    identity: printedContentsAnalysisIdentity,
    layout_source: input.layoutSource,
    pdf_diagnostics: Object.freeze(
      input.pdfDiagnostics.slice(0, 100).map((diagnostic) =>
        Object.freeze({
          code: diagnostic.code,
          page_index: diagnostic.pageIndex ?? null,
        }),
      ),
    ),
    source_id: input.sourceId,
    source_sha256: input.sourceSha256,
    typography: Object.freeze({
      risk_summaries: Object.freeze(
        input.typographyRiskSummaries.slice(0, 100),
      ),
      truncated:
        input.typographyRiskSummariesTruncated ||
        input.typographyRiskSummaries.length > 100,
    }),
  });
  return parsePrintedContentsAnalysisV2(value);
}

export function parsePrintedContentsAnalysisV2(
  input: unknown,
): PrintedContentsAnalysisV2 {
  const value = record(input);
  if (
    !value ||
    !exactKeys(value, [
      "candidates",
      "canonical_region_id",
      "config_revision",
      "evidence_diagnostics",
      "identity",
      "layout_source",
      "pdf_diagnostics",
      "source_id",
      "source_sha256",
      "typography",
    ]) ||
    value.identity !== printedContentsAnalysisIdentity ||
    !Number.isSafeInteger(value.config_revision) ||
    Number(value.config_revision) < 1 ||
    typeof value.source_id !== "string" ||
    !isOpaqueId("source", value.source_id) ||
    !/^[a-f0-9]{64}$/u.test(String(value.source_sha256)) ||
    !["content-list", "native-pdf", "none", "ocr"].includes(
      String(value.layout_source),
    ) ||
    (value.canonical_region_id !== null &&
      (typeof value.canonical_region_id !== "string" ||
        !isOpaqueId("region", value.canonical_region_id))) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 100 ||
    !Array.isArray(value.evidence_diagnostics) ||
    value.evidence_diagnostics.length > 100 ||
    !Array.isArray(value.pdf_diagnostics) ||
    value.pdf_diagnostics.length > 100
  ) {
    throw new Error("PRINTED_CONTENTS_ANALYSIS_INVALID");
  }
  let canonicalCount = 0;
  let canonicalId: string | null = null;
  let totalEntries = 0;
  for (const candidateValue of value.candidates) {
    const candidate = record(candidateValue);
    const alignment = record(candidate?.alignment);
    if (
      !candidate ||
      !exactKeys(candidate, [
        "alignment",
        "boundary_confidence",
        "canonical",
        "diagnostics",
        "end_byte",
        "entries",
        "match_confidence",
        "region_id",
        "start_byte",
      ]) ||
      !alignment ||
      !exactKeys(alignment, ["best_score", "margin", "second_best_score"]) ||
      ![
        alignment.best_score,
        alignment.margin,
        alignment.second_best_score,
      ].every((item) => typeof item === "number" && Number.isFinite(item)) ||
      !["high", "low", "medium"].includes(
        String(candidate.boundary_confidence),
      ) ||
      !["high", "low", "medium"].includes(String(candidate.match_confidence)) ||
      typeof candidate.canonical !== "boolean" ||
      !byteRange(candidate.start_byte, candidate.end_byte) ||
      (candidate.region_id !== null &&
        (typeof candidate.region_id !== "string" ||
          !isOpaqueId("region", candidate.region_id))) ||
      !Array.isArray(candidate.entries) ||
      candidate.entries.length > 20_000 ||
      !Array.isArray(candidate.diagnostics) ||
      candidate.diagnostics.length > 100
    ) {
      throw new Error("PRINTED_CONTENTS_ANALYSIS_INVALID");
    }
    totalEntries += candidate.entries.length;
    if (totalEntries > 20_000) {
      throw new Error("PRINTED_CONTENTS_ANALYSIS_INVALID");
    }
    if (candidate.canonical) {
      canonicalCount += 1;
      canonicalId = String(candidate.region_id);
    }
    for (const entryValue of candidate.entries) {
      const entry = record(entryValue);
      if (
        !entry ||
        !exactKeys(entry, [
          "body_heading_block_id",
          "end_byte",
          "reference_level",
          "start_byte",
        ]) ||
        !byteRange(entry.start_byte, entry.end_byte) ||
        Number(entry.start_byte) < Number(candidate.start_byte) ||
        Number(entry.end_byte) > Number(candidate.end_byte) ||
        !Number.isSafeInteger(entry.reference_level) ||
        Number(entry.reference_level) < 1 ||
        Number(entry.reference_level) > 4 ||
        (entry.body_heading_block_id !== null &&
          (typeof entry.body_heading_block_id !== "string" ||
            !isOpaqueId("block", entry.body_heading_block_id)))
      ) {
        throw new Error("PRINTED_CONTENTS_ANALYSIS_INVALID");
      }
    }
    for (const diagnosticValue of candidate.diagnostics) {
      const diagnostic = record(diagnosticValue);
      if (
        !diagnostic ||
        !exactKeys(diagnostic, ["block_id", "code", "path"]) ||
        !boundedString(diagnostic.code, 80) ||
        typeof diagnostic.path !== "string" ||
        !/^candidates\/\d+(?:\/entries\/\d+)?$/u.test(diagnostic.path) ||
        (diagnostic.block_id !== null &&
          (typeof diagnostic.block_id !== "string" ||
            !isOpaqueId("block", diagnostic.block_id)))
      ) {
        throw new Error("PRINTED_CONTENTS_ANALYSIS_INVALID");
      }
    }
  }
  if (
    (value.canonical_region_id === null && canonicalCount !== 0) ||
    (value.canonical_region_id !== null &&
      (canonicalCount !== 1 || canonicalId !== value.canonical_region_id))
  ) {
    throw new Error("PRINTED_CONTENTS_ANALYSIS_INVALID");
  }
  for (const diagnosticValue of value.evidence_diagnostics) {
    const diagnostic = record(diagnosticValue);
    if (
      !diagnostic ||
      !exactKeys(diagnostic, ["code"]) ||
      ![
        "LAYOUT_EVIDENCE_INVALID",
        "LAYOUT_EVIDENCE_LIMIT_EXCEEDED",
        "LAYOUT_EVIDENCE_UNAVAILABLE",
      ].includes(String(diagnostic.code))
    ) {
      throw new Error("PRINTED_CONTENTS_ANALYSIS_INVALID");
    }
  }
  for (const diagnosticValue of value.pdf_diagnostics) {
    const diagnostic = record(diagnosticValue);
    if (
      !diagnostic ||
      !exactKeys(diagnostic, ["code", "page_index"]) ||
      ![
        "PDF_CONTENTS_EVIDENCE_INVALID",
        "PDF_CONTENTS_NATIVE_ABSENT",
        "PDF_CONTENTS_NOT_DETECTED",
        "PDF_CONTENTS_OCR_LOW_CONFIDENCE",
        "PDF_CONTENTS_OCR_TIMEOUT",
        "PDF_CONTENTS_SOURCE_AMBIGUOUS",
        "PDF_CONTENTS_SOURCE_UNAVAILABLE",
        "PDF_CONTENTS_TOOL_UNAVAILABLE",
      ].includes(String(diagnostic.code)) ||
      (diagnostic.page_index !== null &&
        (!Number.isSafeInteger(diagnostic.page_index) ||
          Number(diagnostic.page_index) < 0 ||
          Number(diagnostic.page_index) >= 48))
    ) {
      throw new Error("PRINTED_CONTENTS_ANALYSIS_INVALID");
    }
  }
  const typography = record(value.typography);
  if (
    !typography ||
    !exactKeys(typography, ["risk_summaries", "truncated"]) ||
    typeof typography.truncated !== "boolean" ||
    !Array.isArray(typography.risk_summaries) ||
    typography.risk_summaries.length > 100 ||
    !typography.risk_summaries.every(validRisk)
  ) {
    throw new Error("PRINTED_CONTENTS_ANALYSIS_INVALID");
  }
  return input as PrintedContentsAnalysisV2;
}
