import { dirname } from "node:path";
import type { NormalizedDocument } from "../../core/preparation/document-model";
import {
  supplementMissingListPageLabels,
  type LayoutEvidence,
} from "../../core/preparation/layout-evidence";
import {
  createPrintedContentsDocumentIndex,
  detectPrintedContents,
  requiresSupplementalPdfEvidence,
  shouldUseNativePdfDetection,
  supplementalPdfPageIndices,
} from "../../core/preparation/printed-contents";
import { findOriginalPdf } from "../filesystem/find-original-pdf";
import { readPdfContentsEvidence } from "../filesystem/read-pdf-contents-evidence";

export type PdfEvidenceReader = typeof readPdfContentsEvidence;

export async function recoverMineruContents(input: {
  readonly document: NormalizedDocument;
  readonly sourcePath: string;
  readonly stagingDirectory: string;
  readonly layout: LayoutEvidence;
  readonly signal?: AbortSignal;
  readonly pdfEvidenceReader?: PdfEvidenceReader;
}) {
  const documentIndex = createPrintedContentsDocumentIndex(input.document);
  let layout = input.layout;
  const detect = (evidence: LayoutEvidence) =>
    detectPrintedContents({
      document: input.document,
      documentIndex,
      layoutEvidence: evidence,
    });
  let detection = detect(layout);
  if (requiresSupplementalPdfEvidence(detection)) {
    const discovered = await findOriginalPdf({
      bundleRoot: dirname(input.sourcePath),
      markdownPath: input.sourcePath,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if ("pdfPath" in discovered) {
      const pages = supplementalPdfPageIndices(detection);
      const pdf = await (input.pdfEvidenceReader ?? readPdfContentsEvidence)({
        pdfPath: discovered.pdfPath,
        temporaryRoot: input.stagingDirectory,
        allowOcr:
          !detection.candidates.some(
            (candidate) => candidate.boundaryConfidence === "high",
          ) ||
          detection.candidates.some(
            (candidate) => candidate.requiresPdfEvidence,
          ),
        recoverPageLabels: true,
        ...(pages ? { pageIndices: pages } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (pdf.records.length) {
        const native = {
          records: pdf.records,
          diagnostics: [],
          source: pdf.source,
        };
        const repaired = supplementMissingListPageLabels(layout, native);
        const nativeDetection = detect(native);
        const repairedDetection = detect(repaired);
        const preferNative = shouldUseNativePdfDetection({
          nativeDetection,
          nativeLayout: native,
          sourceDetection: repairedDetection,
          sourceLayout: repaired,
        });
        layout = preferNative ? native : repaired;
        detection = preferNative ? nativeDetection : repairedDetection;
      }
    }
  }
  return { layout, detection };
}
