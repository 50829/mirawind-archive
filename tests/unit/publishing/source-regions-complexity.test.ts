import { describe, expect, it } from "vitest";

import {
  buildSourceRegionFixture,
  evaluateSourceRegionScale,
  runSourceRegionCase,
} from "../../../scripts/benchmarks/compilation-complexity.js";
import { SourceTextIndex } from "@/modules/publishing/core/preparation/source-text-index";

describe("source-region compilation complexity", () => {
  it("indexes every valid UTF-16 boundary as an exact UTF-8 byte offset", () => {
    const source = "ASCII 中文 😀 tail";
    const index = new SourceTextIndex(source);
    const boundaries = [0, 1, 6, 7, 9, 10, 12, 14, source.length];

    for (const offset of boundaries) {
      expect(index.byteOffsetAt(offset)).toBe(
        Buffer.byteLength(source.slice(0, offset), "utf8"),
      );
    }
    expect(() => index.byteOffsetAt(-1)).toThrow(RangeError);
    expect(() => index.byteOffsetAt(source.length + 1)).toThrow(RangeError);
  });

  it("preserves exact exclusions across every benchmark size", () => {
    for (const rootCount of [500, 1_000, 2_000, 4_000]) {
      const fixture = buildSourceRegionFixture(rootCount);
      const measurement = runSourceRegionCase(rootCount, 1);

      expect(fixture.document.root.children).toHaveLength(rootCount);
      expect(measurement).toMatchObject({
        active_roots: rootCount - Math.floor(rootCount / 4),
        excluded_blocks: Math.floor(rootCount / 4),
        root_count: rootCount,
      });
    }
  });

  it("keeps fourfold input growth below the sixfold scale gate", () => {
    const measurements = [500, 1_000, 2_000, 4_000].map((rootCount) =>
      runSourceRegionCase(rootCount, 11),
    );

    expect(evaluateSourceRegionScale(measurements)).toMatchObject({
      passed: true,
      ratio_4000_to_1000: expect.any(Number),
    });
  });
});
