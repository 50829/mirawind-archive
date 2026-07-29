import { describe, expect, it } from "vitest";

import {
  buildSourceRegionFixture,
  evaluateSourceRegionScale,
  runSourceRegionCase,
  type ComplexityMeasurement,
} from "../../../scripts/benchmarks/compilation-complexity.js";

describe("compilation complexity benchmark", () => {
  it("builds an exact source-region fixture and verifies its output", () => {
    const fixture = buildSourceRegionFixture(20);
    expect(fixture.document.root.children).toHaveLength(20);
    expect(runSourceRegionCase(20, 1)).toMatchObject({
      active_roots: 15,
      excluded_blocks: 5,
      root_count: 20,
    });
  });

  it("evaluates the fourfold source-region scale gate", () => {
    const measurement = (
      root_count: number,
      median_ms: number,
    ): ComplexityMeasurement => ({
      active_roots: root_count * 0.75,
      excluded_blocks: root_count * 0.25,
      median_ms,
      repetitions: 5,
      root_count,
    });
    expect(
      evaluateSourceRegionScale([
        measurement(1_000, 100),
        measurement(4_000, 590),
      ]).passed,
    ).toBe(true);
    expect(
      evaluateSourceRegionScale([
        measurement(1_000, 100),
        measurement(4_000, 600),
      ]).passed,
    ).toBe(false);
  });
});
