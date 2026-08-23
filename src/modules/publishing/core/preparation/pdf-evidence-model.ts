import type { LayoutEvidenceRecord } from "./layout-evidence";

export interface PdfContentsEvidenceDiagnostic {
  readonly code:
    | "PDF_CONTENTS_EVIDENCE_INVALID"
    | "PDF_CONTENTS_NATIVE_ABSENT"
    | "PDF_CONTENTS_NOT_DETECTED"
    | "PDF_CONTENTS_OCR_LOW_CONFIDENCE"
    | "PDF_CONTENTS_OCR_TIMEOUT"
    | "PDF_CONTENTS_TOOL_UNAVAILABLE";
  readonly pageIndex?: number;
}

export interface PdfContentsEvidence {
  readonly diagnostics: readonly PdfContentsEvidenceDiagnostic[];
  readonly inspectedPageIndices: readonly number[];
  readonly records: readonly LayoutEvidenceRecord[];
  readonly source: "native-pdf" | "none" | "ocr";
}

export type PdfSourceDiagnostic =
  "PDF_CONTENTS_SOURCE_AMBIGUOUS" | "PDF_CONTENTS_SOURCE_UNAVAILABLE";
