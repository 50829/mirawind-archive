import { basename, dirname } from "node:path";

import {
  readMineruLayoutEvidence,
  supplementMissingListPageLabels,
} from "@/compiler/document/layout-evidence";
import type { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { readPdfContentsEvidence } from "@/compiler/document/pdf-contents-evidence";
import { findOriginalPdf } from "@/compiler/document/pdf-source";
import {
  detectPrintedContents,
  requiresSupplementalPdfEvidence,
  shouldUseNativePdfDetection,
  supplementalPdfPageIndices,
} from "@/compiler/document/printed-toc";
import { applySourceRegions } from "@/compiler/document/source-regions";
import { proposeDocumentStructure } from "@/compiler/document/structure-proposal";
import type {
  PreparedDraftArtifact,
  PreparedPdfDiagnostic,
} from "@/jobs/handlers/prepared-draft-artifact";
import {
  profilePipelineStage,
  recordPipelineProfileMetrics,
} from "@/observability/pipeline-profile";

type NormalizedDocument = ReturnType<typeof normalizeDocumentBlocks>;
type ContentsResult = Pick<
  PreparedDraftArtifact,
  | "layoutDiagnostics"
  | "layoutSource"
  | "pdfDiagnostics"
  | "printedContents"
  | "sourceRegions"
  | "structure"
  | "title"
>;

export async function analyzeDraftContents(input: {
  readonly markdownPath: string;
  readonly normalized: NormalizedDocument;
  readonly pdfEvidenceReader?: typeof readPdfContentsEvidence;
  readonly selectedCandidatePath: string;
  readonly signal?: AbortSignal;
  readonly sourceSha256: string;
  readonly stagingDirectory: string;
}): Promise<ContentsResult> {
  const layoutEvidence = await profilePipelineStage("layout_evidence", () =>
    readMineruLayoutEvidence(input.markdownPath, input.signal),
  );
  recordPipelineProfileMetrics({
    layout_records: layoutEvidence.records.length,
  });
  let effectiveLayoutEvidence = layoutEvidence;
  let printedContents = await profilePipelineStage(
    "initial_printed_contents",
    () =>
      detectPrintedContents({
        document: input.normalized,
        layoutEvidence,
        sourcePath: basename(input.selectedCandidatePath),
        sourceSha256: input.sourceSha256,
      }),
  );
  const hasHighBoundary = printedContents.candidates.some(
    (candidate) => candidate.boundaryConfidence === "high",
  );
  const requiresLineRepair = printedContents.candidates.some(
    (candidate) =>
      candidate.proposedRegion !== undefined && candidate.requiresPdfEvidence,
  );
  let pdfDiagnostics: readonly PreparedPdfDiagnostic[] = Object.freeze([]);
  if (requiresSupplementalPdfEvidence(printedContents)) {
    const pdfResult = await profilePipelineStage("pdf_evidence", async () => {
      const discovered = await findOriginalPdf({
        bundleRoot: dirname(input.markdownPath),
        markdownPath: input.markdownPath,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if ("diagnostic" in discovered) return { discovered } as const;
      const pageIndices = supplementalPdfPageIndices(printedContents);
      const evidence = await (
        input.pdfEvidenceReader ?? readPdfContentsEvidence
      )({
        allowOcr: !hasHighBoundary || requiresLineRepair,
        ...(pageIndices ? { pageIndices } : {}),
        pdfPath: discovered.pdfPath,
        recoverPageLabels: requiresLineRepair,
        ...(input.signal ? { signal: input.signal } : {}),
        temporaryRoot: input.stagingDirectory,
      });
      return { discovered, evidence } as const;
    });
    const { discovered } = pdfResult;
    if ("diagnostic" in discovered) {
      pdfDiagnostics = Object.freeze([
        Object.freeze({ code: discovered.diagnostic }),
      ]);
    } else {
      if (!("evidence" in pdfResult)) {
        throw new Error("PDF_EVIDENCE_PROFILE_RESULT_INVALID");
      }
      const pdfEvidence = pdfResult.evidence;
      pdfDiagnostics = pdfEvidence.diagnostics;
      recordPipelineProfileMetrics({
        pdf_pages: new Set(
          pdfEvidence.records.map((record) => record.pageIndex),
        ).size,
      });
      if (pdfEvidence.records.length > 0) {
        await profilePipelineStage("repaired_printed_contents", () => {
          const pdfLayoutEvidence = Object.freeze({
            diagnostics: layoutEvidence.diagnostics,
            records: pdfEvidence.records,
            source: pdfEvidence.source,
          });
          const repairedLayoutEvidence = supplementMissingListPageLabels(
            layoutEvidence,
            pdfLayoutEvidence,
          );
          const repairedDetection = detectPrintedContents({
            document: input.normalized,
            layoutEvidence: repairedLayoutEvidence,
            sourcePath: basename(input.selectedCandidatePath),
            sourceSha256: input.sourceSha256,
          });
          const nativeDetection = detectPrintedContents({
            document: input.normalized,
            layoutEvidence: pdfLayoutEvidence,
            sourcePath: basename(input.selectedCandidatePath),
            sourceSha256: input.sourceSha256,
          });
          const preferNative = shouldUseNativePdfDetection({
            nativeDetection,
            nativeLayout: pdfLayoutEvidence,
            sourceDetection: repairedDetection,
            sourceLayout: repairedLayoutEvidence,
          });
          effectiveLayoutEvidence =
            repairedLayoutEvidence.source === "none" || preferNative
              ? pdfLayoutEvidence
              : repairedLayoutEvidence;
          printedContents = preferNative ? nativeDetection : repairedDetection;
        });
      }
    }
  }
  recordPipelineProfileMetrics({
    printed_entries: printedContents.candidates.reduce(
      (total, candidate) => total + candidate.logicalEntries.length,
      0,
    ),
    printed_regions: printedContents.candidates.length,
  });
  const { activeDocument, sourceRegions } = await profilePipelineStage(
    "source_regions",
    () => {
      const regions = printedContents.candidates.flatMap((candidate) =>
        candidate.proposedRegion ? [candidate.proposedRegion] : [],
      );
      return {
        activeDocument: applySourceRegions({
          document: input.normalized,
          mainMarkdownPath: basename(input.selectedCandidatePath),
          mainMarkdownSha256: input.sourceSha256,
          regions,
        }).document,
        sourceRegions: regions,
      };
    },
  );
  const printedEntries = printedContents.candidates.flatMap((candidate) =>
    candidate.canonical
      ? candidate.logicalEntries.map((entry) =>
          Object.freeze({
            ...(entry.bodyHeadingBlockId
              ? { bodyHeadingBlockId: entry.bodyHeadingBlockId }
              : {}),
            referenceLevel: entry.referenceLevel,
            sourceTitle: entry.sourceTitle,
          }),
        )
      : [],
  );
  const proposal = await profilePipelineStage("structure_proposal", () =>
    proposeDocumentStructure(input.normalized, {
      printedEntries,
      sourceRegions,
    }),
  );
  return Object.freeze({
    layoutDiagnostics: layoutEvidence.diagnostics,
    layoutSource: effectiveLayoutEvidence.source,
    pdfDiagnostics,
    printedContents: Object.freeze(
      printedContents.candidates.map((candidate) =>
        Object.freeze({
          alignment: candidate.alignment,
          boundaryConfidence: candidate.boundaryConfidence,
          canonical: candidate.canonical,
          confidence: candidate.confidence,
          diagnostics: candidate.diagnostics,
          endByte: candidate.endByte,
          entryCount: candidate.entryCount,
          matchedHeadingCount: candidate.matchedHeadingCount,
          matchConfidence: candidate.matchConfidence,
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
  });
}
