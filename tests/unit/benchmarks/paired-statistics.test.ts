import { describe, expect, it } from "vitest";

import {
  evaluatePairedPerformance,
  type BenchmarkRun,
  type FixtureMeasurement,
} from "../../../scripts/benchmarks/paired-statistics.js";

const fixtureIds = Array.from(
  { length: 15 },
  (_, index) => `real-mineru-${String(index + 1).padStart(12, "0")}`,
);

function measurements(
  variant: "baseline" | "candidate",
  scale = variant === "baseline" ? 1 : 0.6,
): readonly FixtureMeasurement[] {
  return fixtureIds.map((fixtureId, index) => ({
    accepted_to_preview_ms: (20_000 + index * 1_000) * scale,
    fixture_id: fixtureId,
    peak_process_tree_rss_bytes: 1_000_000_000,
    publish_to_public_ms:
      (5_000 + index * 100) * (variant === "baseline" ? 1 : 0.05),
    reference_exact: true,
    status: "passed",
    wall_ms: (30_000 + index * 2_000) * scale,
  }));
}

function run(
  pairIndex: number,
  variant: "baseline" | "candidate",
  scale?: number,
): BenchmarkRun {
  const order = pairIndex % 2 === 0 ? "BA" : "AB";
  return {
    commit_sha: variant === "baseline" ? "b".repeat(40) : "c".repeat(40),
    dirty: false,
    environment_sha256: "d".repeat(64),
    fixture_order: fixtureIds,
    fixture_manifest_sha256: "e".repeat(64),
    lockfile_sha256: "f".repeat(64),
    measurements: measurements(variant, scale),
    order,
    pair_index: pairIndex,
    position: order.indexOf(variant === "baseline" ? "A" : "B") + 1,
    reference_report_sha256: "1".repeat(64),
    raw_environment_report_sha256: "2".repeat(64),
    variant,
  };
}

function threePairs(): readonly BenchmarkRun[] {
  return [1, 2, 3].flatMap((pairIndex) => [
    run(pairIndex, "baseline"),
    run(pairIndex, "candidate"),
  ]);
}

describe("paired pipeline statistics", () => {
  it("passes all performance gates from three stable exact pairs", () => {
    const result = evaluatePairedPerformance(threePairs());
    expect(result.passed).toBe(true);
    expect(result.fixture_count).toBe(15);
    expect(result.pair_count).toBe(3);
    expect(result.gates).toMatchObject({
      accepted_to_preview: true,
      peak_rss: true,
      publish_to_public: true,
      single_book_regression: true,
      slowest_five_wall: true,
      total_wall: true,
    });
  });

  it("fails a single-book regression even when aggregate time improves", () => {
    const runs = [...threePairs()];
    for (const candidate of runs.filter(
      (item) => item.variant === "candidate",
    )) {
      const values = [...candidate.measurements];
      const firstValue = values[0];
      const baselineValue = measurements("baseline")[0];
      if (!firstValue || !baselineValue)
        throw new Error("test fixture missing");
      values[0] = {
        ...firstValue,
        wall_ms: baselineValue.wall_ms + 2_000,
      };
      (
        candidate as { measurements: readonly FixtureMeasurement[] }
      ).measurements = values;
    }
    const result = evaluatePairedPerformance(runs);
    expect(result.passed).toBe(false);
    expect(result.gates.single_book_regression).toBe(false);
    expect(result.regressed_fixture_ids).toEqual([fixtureIds[0]]);
  });

  it("requires five pairs when three-pair variability exceeds ten percent", () => {
    const scales = [0.4, 0.8, 0.5];
    const runs = scales.flatMap((scale, index) => [
      run(index + 1, "baseline"),
      run(index + 1, "candidate", scale),
    ]);
    const result = evaluatePairedPerformance(runs);
    expect(result.requires_five_pairs).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("rejects non-exact, dirty and incomplete fifteen-book runs", () => {
    const nonExact = [...threePairs()];
    const candidate = nonExact.find((item) => item.variant === "candidate");
    if (!candidate) throw new Error("test candidate missing");
    (candidate as { dirty: boolean }).dirty = true;
    expect(() => evaluatePairedPerformance(nonExact)).toThrow(
      "PAIRED_RUN_DIRTY",
    );

    const incomplete = [...threePairs()];
    const first = incomplete[0];
    if (!first) throw new Error("test run missing");
    (first as { measurements: readonly FixtureMeasurement[] }).measurements =
      first.measurements.slice(0, 14);
    expect(() => evaluatePairedPerformance(incomplete)).toThrow(
      "PAIRED_FIXTURE_COUNT_INVALID",
    );
  });
});
