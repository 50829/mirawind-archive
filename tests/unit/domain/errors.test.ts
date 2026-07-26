import { describe, expect, it } from "vitest";

import { createSafeDiagnostic } from "@/domain/errors";

describe("safe locatable diagnostics", () => {
  it("retains bounded evidence, location and valid recovery actions", () => {
    const diagnostic = createSafeDiagnostic({
      code: "PRINTED_TOC_UNMATCHED_ENTRY",
      confidence: "low",
      evidence: ["numbering", "x".repeat(500)],
      location: {
        blockId: "blk_abcdefghijklmnop",
        endByte: 20,
        pageIndex: 3,
        regionId: "region_abcdefghijklmnop",
        startByte: 10,
      },
      message: "No unique body heading was found.",
      phase: "matching",
      recovery: ["select_structure", "reload"],
      severity: "warning",
    });

    expect(diagnostic).toMatchObject({
      confidence: "low",
      location: { endByte: 20, pageIndex: 3, startByte: 10 },
      phase: "matching",
      recovery: ["select_structure", "reload"],
    });
    expect(diagnostic.evidence?.[1]).toHaveLength(200);
    expect(diagnostic.location?.blockId).toBe("blk_abcdefghijklmnop");
    expect(diagnostic.location?.regionId).toBe("region_abcdefghijklmnop");
  });

  it("drops invalid ranges and enum values from generated input", () => {
    const diagnostic = createSafeDiagnostic({
      code: "LAYOUT_EVIDENCE_INVALID",
      confidence: "unknown" as "low",
      location: {
        blockId: "private body text",
        endByte: 2,
        regionId: "raw/archive/path",
        startByte: 2,
      },
      message: "Invalid evidence.",
      phase: "unknown" as "contents",
      recovery: ["unknown" as "reload"],
    });

    expect(diagnostic.confidence).toBeUndefined();
    expect(diagnostic.phase).toBeUndefined();
    expect(diagnostic.recovery).toBeUndefined();
    expect(diagnostic.location).toBeUndefined();
  });

  it("drops manual structure adjudication actions", () => {
    const diagnostic = createSafeDiagnostic({
      code: "PRINTED_TOC_LOW_CONFIDENCE",
      message: "The automatic evidence was insufficient.",
      recovery: ["enable_region" as "reload"],
    });

    expect(diagnostic.recovery).toBeUndefined();
  });
});
