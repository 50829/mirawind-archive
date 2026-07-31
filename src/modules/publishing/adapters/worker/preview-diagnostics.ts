import { readFile, stat } from "node:fs/promises";

import {
  parsePrintedContentsAnalysisV2,
  type PrintedContentsAnalysisV2,
} from "@/modules/publishing/core/preparation/printed-contents-analysis";
import { createSafeDiagnostic, type SafeDiagnostic } from "@/domain/errors";

export function printedContentsDiagnostics(
  analysis: PrintedContentsAnalysisV2,
): readonly SafeDiagnostic[] {
  return Object.freeze([
    ...analysis.evidence_diagnostics.map((diagnostic) =>
      createSafeDiagnostic({
        code: diagnostic.code,
        confidence: "low",
        evidence: Object.freeze(["bounded MinerU layout evidence"]),
        message:
          "The layout companion could not be used completely; accepted Markdown was retained.",
        phase: "contents",
        severity: "warning",
      }),
    ),
    ...analysis.pdf_diagnostics.map((diagnostic) =>
      createSafeDiagnostic({
        code: diagnostic.code,
        confidence: "low",
        evidence: Object.freeze(["bounded native PDF or OCR evidence"]),
        ...(diagnostic.page_index === null
          ? {}
          : { location: { pageIndex: diagnostic.page_index } }),
        message:
          "PDF evidence was unavailable or insufficient; no uncertain structure was promoted.",
        phase: "ocr",
        severity: "warning",
      }),
    ),
    ...analysis.candidates.flatMap((candidate) =>
      candidate.diagnostics.map((diagnostic) =>
        createSafeDiagnostic({
          code: diagnostic.code,
          confidence:
            candidate.boundary_confidence === "low" ||
            candidate.match_confidence === "low"
              ? "low"
              : candidate.boundary_confidence === "high" &&
                  candidate.match_confidence === "high"
                ? "high"
                : "medium",
          evidence: Object.freeze([
            "printed contents order",
            analysis.layout_source === "content-list"
              ? "MinerU page layout"
              : analysis.layout_source === "none"
                ? "Markdown numbering"
                : "PDF page evidence",
          ]),
          location: {
            ...(diagnostic.block_id ? { blockId: diagnostic.block_id } : {}),
            endByte: candidate.end_byte,
            ...(candidate.region_id ? { regionId: candidate.region_id } : {}),
            startByte: candidate.start_byte,
          },
          message:
            diagnostic.code === "PRINTED_TOC_AMBIGUOUS_MATCH"
              ? "A printed contents entry has more than one plausible body heading."
              : diagnostic.code === "PRINTED_TOC_UNMATCHED_ENTRY"
                ? "A printed contents entry could not be matched to a body heading."
                : "The automatic printed contents evidence was insufficient for a definite proposal.",
          path: diagnostic.path,
          phase: diagnostic.code.includes("MATCH") ? "matching" : "contents",
          severity:
            diagnostic.code === "PRINTED_TOC_LOW_COVERAGE" ||
            diagnostic.code === "PRINTED_TOC_RICH_CONTENT"
              ? "warning"
              : "info",
        }),
      ),
    ),
    ...analysis.typography.risk_summaries.map((risk) =>
      createSafeDiagnostic({
        code: risk.code,
        confidence: "medium",
        evidence: Object.freeze([
          `${risk.spaces_normalized} spacing edits`,
          `${risk.punctuation_converted} punctuation edits`,
        ]),
        location: { endByte: risk.end_byte, startByte: risk.start_byte },
        message:
          "Typography changed a mixed source range; reprocess from retained input to restore verbatim bytes.",
        phase: "typography",
        severity: "warning",
        targets: Object.freeze([{ kind: "reprocess_verbatim" }]),
      }),
    ),
  ]);
}

export async function readPinnedAnalysis(input: {
  readonly analysisPath: string;
  readonly configRevision: number;
  readonly sourceId: string;
  readonly sourceSha256: string;
}): Promise<PrintedContentsAnalysisV2> {
  if ((await stat(input.analysisPath)).size > 4 * 1024 * 1024) {
    throw new Error("PREVIEW_ANALYSIS_INVALID");
  }
  const analysis = parsePrintedContentsAnalysisV2(
    JSON.parse(await readFile(input.analysisPath, "utf8")),
  );
  if (
    analysis.config_revision !== input.configRevision ||
    analysis.source_id !== input.sourceId ||
    analysis.source_sha256 !== input.sourceSha256
  ) {
    throw new Error("PREVIEW_ANALYSIS_CAPTURE_MISMATCH");
  }
  return analysis;
}
