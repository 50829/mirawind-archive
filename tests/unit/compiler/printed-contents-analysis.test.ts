import { describe, expect, it } from "vitest";

import {
  parsePrintedContentsAnalysis,
  printedContentsAnalysisIdentity,
} from "@/modules/publishing/core/preparation/printed-contents-analysis";

const hash = "a".repeat(64);

function entry() {
  return {
    body_heading_block_id: "blk_0123456789abcdef",
    end_byte: 80,
    reference_level: 1,
    start_byte: 20,
  };
}

function diagnostic() {
  return {
    block_id: "blk_0123456789abcdef",
    code: "PRINTED_TOC_UNMATCHED_ENTRY",
    path: "candidates/0/entries/0",
  };
}

function candidate() {
  return {
    alignment: {
      best_score: 4,
      margin: 2,
      second_best_score: 2,
    },
    boundary_confidence: "high",
    canonical: true,
    diagnostics: [diagnostic()],
    end_byte: 100,
    entries: [entry()],
    match_confidence: "medium",
    region_id: "region_0123456789abcdef",
    start_byte: 10,
  };
}

function analysis() {
  return {
    candidates: [candidate()],
    canonical_region_id: "region_0123456789abcdef",
    config_revision: 2,
    evidence_diagnostics: [{ code: "LAYOUT_EVIDENCE_INVALID" }],
    identity: printedContentsAnalysisIdentity,
    layout_source: "content-list",
    pdf_diagnostics: [{ code: "PDF_CONTENTS_NATIVE_ABSENT", page_index: 3 }],
    source_id: "src_0123456789abcdef",
    source_sha256: hash,
    typography: {
      risk_summaries: [
        {
          code: "TYPOGRAPHY_SPACING_REWRITE",
          end_byte: 30,
          punctuation_converted: 0,
          spaces_normalized: 1,
          start_byte: 20,
        },
      ],
      truncated: false,
    },
  };
}

describe("printed contents analysis v2", () => {
  it("accepts the strict private artifact", () => {
    expect(parsePrintedContentsAnalysis(analysis())).toMatchObject({
      canonical_region_id: "region_0123456789abcdef",
      config_revision: 2,
      identity: printedContentsAnalysisIdentity,
      source_sha256: hash,
    });
  });

  it("rejects unknown fields, identity, hashes and revisions", () => {
    expect(() =>
      parsePrintedContentsAnalysis({ ...analysis(), title: "private text" }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({ ...analysis(), identity: "v1" }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({ ...analysis(), source_sha256: "bad" }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({ ...analysis(), config_revision: 0 }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        source_id: "source_not_opaque",
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
  });

  it("rejects invalid ranges and inconsistent canonical selection", () => {
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        candidates: [{ ...candidate(), end_byte: 10 }],
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        candidates: [
          { ...candidate(), entries: [{ ...entry(), end_byte: 101 }] },
        ],
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        canonical_region_id: "region_other",
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        candidates: [{ ...candidate(), canonical: true, region_id: null }],
        canonical_region_id: null,
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
  });

  it("rejects oversized candidate, entry and diagnostic collections", () => {
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        candidates: Array.from({ length: 101 }, candidate),
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        candidates: [
          { ...candidate(), entries: Array.from({ length: 20_001 }, entry) },
        ],
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        candidates: [
          { ...candidate(), entries: Array.from({ length: 10_001 }, entry) },
          {
            ...candidate(),
            canonical: false,
            entries: Array.from({ length: 10_000 }, entry),
            region_id: "region_abcdefghijklmnop",
          },
        ],
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        candidates: [
          {
            ...candidate(),
            diagnostics: Array.from({ length: 101 }, diagnostic),
          },
        ],
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        evidence_diagnostics: Array.from({ length: 101 }, () => ({
          code: "LAYOUT_EVIDENCE_INVALID",
        })),
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        pdf_diagnostics: Array.from({ length: 101 }, () => ({
          code: "PDF_CONTENTS_NATIVE_ABSENT",
          page_index: null,
        })),
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
    expect(() =>
      parsePrintedContentsAnalysis({
        ...analysis(),
        typography: {
          ...analysis().typography,
          risk_summaries: Array.from(
            { length: 101 },
            () => analysis().typography.risk_summaries[0],
          ),
        },
      }),
    ).toThrow("PRINTED_CONTENTS_ANALYSIS_INVALID");
  });
});
