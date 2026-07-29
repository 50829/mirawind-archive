import type { BenchmarkRun, FixtureMeasurement } from "./paired-report.js";

export type { BenchmarkRun, FixtureMeasurement } from "./paired-report.js";

interface GateResults {
  readonly accepted_to_preview: boolean;
  readonly peak_rss: boolean;
  readonly publish_to_public: boolean;
  readonly single_book_regression: boolean;
  readonly slowest_five_wall: boolean;
  readonly total_wall: boolean;
}

export interface PairedPerformanceResult {
  readonly fixture_count: number;
  readonly gates: GateResults;
  readonly maximum_cv: number;
  readonly pair_count: number;
  readonly passed: boolean;
  readonly regressed_fixture_ids: readonly string[];
  readonly requires_five_pairs: boolean;
  readonly reductions: {
    readonly accepted_to_preview: number;
    readonly publish_to_public: number;
    readonly slowest_five_wall: number;
    readonly total_wall: number;
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("PAIRED_VALUES_EMPTY");
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) throw new Error("PAIRED_VALUES_EMPTY");
  if (sorted.length % 2 !== 0) return upper;
  const lower = sorted[middle - 1];
  if (lower === undefined) throw new Error("PAIRED_VALUES_EMPTY");
  return (lower + upper) / 2;
}

function measurementFor(
  run: BenchmarkRun,
  fixtureId: string,
): FixtureMeasurement {
  const measurement = run.measurements.find(
    (item) => item.fixture_id === fixtureId,
  );
  if (!measurement) throw new Error("PAIRED_FIXTURE_COUNT_INVALID");
  return measurement;
}

function coefficientOfVariation(values: readonly number[]): number {
  const mean =
    values.reduce((total, value) => total + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function sum(
  measurements: readonly FixtureMeasurement[],
  select: (measurement: FixtureMeasurement) => number,
): number {
  return measurements.reduce((total, item) => total + select(item), 0);
}

function reduction(baseline: number, candidate: number): number {
  if (baseline <= 0) throw new Error("PAIRED_BASELINE_INVALID");
  return 1 - candidate / baseline;
}

function validateRuns(runs: readonly BenchmarkRun[]): {
  readonly fixtureIds: readonly string[];
  readonly pairs: readonly {
    readonly baseline: BenchmarkRun;
    readonly candidate: BenchmarkRun;
  }[];
} {
  const pairCount = new Set(runs.map((run) => run.pair_index)).size;
  if (![3, 5].includes(pairCount) || runs.length !== pairCount * 2) {
    throw new Error("PAIRED_RUN_COUNT_INVALID");
  }
  const manifestHashes = new Set(
    runs.map((run) => run.fixture_manifest_sha256),
  );
  const environmentHashes = new Set(runs.map((run) => run.environment_sha256));
  if (manifestHashes.size !== 1 || environmentHashes.size !== 1) {
    throw new Error("PAIRED_RUN_BINDING_MISMATCH");
  }
  if (runs.some((run) => run.dirty)) throw new Error("PAIRED_RUN_DIRTY");

  const pairs = Array.from({ length: pairCount }, (_, index) => {
    const pairIndex = index + 1;
    const pairRuns = runs.filter((run) => run.pair_index === pairIndex);
    const baseline = pairRuns.find((run) => run.variant === "baseline");
    const candidate = pairRuns.find((run) => run.variant === "candidate");
    const expectedOrder = pairIndex % 2 === 0 ? "BA" : "AB";
    if (
      pairRuns.length !== 2 ||
      !baseline ||
      !candidate ||
      baseline.order !== expectedOrder ||
      candidate.order !== expectedOrder
    ) {
      throw new Error("PAIRED_RUN_ORDER_INVALID");
    }
    return Object.freeze({ baseline, candidate });
  });

  const firstPair = pairs[0];
  if (!firstPair) throw new Error("PAIRED_RUN_COUNT_INVALID");
  const firstIds = firstPair.baseline.measurements
    .map((measurement) => measurement.fixture_id)
    .toSorted();
  if (firstIds.length !== 15 || new Set(firstIds).size !== 15) {
    throw new Error("PAIRED_FIXTURE_COUNT_INVALID");
  }
  for (const run of runs) {
    const ids = run.measurements
      .map((measurement) => measurement.fixture_id)
      .toSorted();
    if (
      ids.length !== 15 ||
      ids.some((id, index) => id !== firstIds[index]) ||
      run.measurements.some(
        (measurement) =>
          measurement.status !== "passed" || !measurement.reference_exact,
      )
    ) {
      throw new Error(
        ids.length === 15
          ? "PAIRED_REFERENCE_NOT_EXACT"
          : "PAIRED_FIXTURE_COUNT_INVALID",
      );
    }
  }
  return Object.freeze({ fixtureIds: Object.freeze(firstIds), pairs });
}

export function evaluatePairedPerformance(
  runs: readonly BenchmarkRun[],
): PairedPerformanceResult {
  const { fixtureIds, pairs } = validateRuns(runs);
  const baselineFixtureMedians = new Map(
    fixtureIds.map((fixtureId) => [
      fixtureId,
      median(
        pairs.map(
          ({ baseline }) => measurementFor(baseline, fixtureId).wall_ms,
        ),
      ),
    ]),
  );
  const slowestFive = [...baselineFixtureMedians.entries()]
    .toSorted((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([fixtureId]) => fixtureId);

  const pairMetrics = pairs.map(({ baseline, candidate }) => {
    const baselineSlowest = baseline.measurements.filter((item) =>
      slowestFive.includes(item.fixture_id),
    );
    const candidateSlowest = candidate.measurements.filter((item) =>
      slowestFive.includes(item.fixture_id),
    );
    const baselineWall = sum(baseline.measurements, (item) => item.wall_ms);
    const candidateWall = sum(candidate.measurements, (item) => item.wall_ms);
    const baselineAccepted = sum(
      baseline.measurements,
      (item) => item.accepted_to_preview_ms,
    );
    const candidateAccepted = sum(
      candidate.measurements,
      (item) => item.accepted_to_preview_ms,
    );
    const baselinePublish = sum(
      baseline.measurements,
      (item) => item.publish_to_public_ms,
    );
    const candidatePublish = sum(
      candidate.measurements,
      (item) => item.publish_to_public_ms,
    );
    return Object.freeze({
      acceptedReduction: reduction(baselineAccepted, candidateAccepted),
      candidateRss: Math.max(
        ...candidate.measurements.map(
          (item) => item.peak_process_tree_rss_bytes,
        ),
      ),
      candidateWall,
      publishReduction: reduction(baselinePublish, candidatePublish),
      rssBaseline: Math.max(
        ...baseline.measurements.map(
          (item) => item.peak_process_tree_rss_bytes,
        ),
      ),
      slowestReduction: reduction(
        sum(baselineSlowest, (item) => item.wall_ms),
        sum(candidateSlowest, (item) => item.wall_ms),
      ),
      wallReduction: reduction(baselineWall, candidateWall),
      wallRatio: candidateWall / baselineWall,
    });
  });

  const regressedFixtureIds = fixtureIds.filter((fixtureId) => {
    const baseline = baselineFixtureMedians.get(fixtureId);
    if (baseline === undefined) throw new Error("PAIRED_FIXTURE_COUNT_INVALID");
    const candidate = median(
      pairs.map(({ candidate: run }) => measurementFor(run, fixtureId).wall_ms),
    );
    return candidate > baseline + Math.max(baseline * 0.05, 1_000);
  });
  const baselineRss = median(pairMetrics.map((metric) => metric.rssBaseline));
  const candidateRss = median(pairMetrics.map((metric) => metric.candidateRss));
  const reductions = Object.freeze({
    accepted_to_preview: median(
      pairMetrics.map((metric) => metric.acceptedReduction),
    ),
    publish_to_public: median(
      pairMetrics.map((metric) => metric.publishReduction),
    ),
    slowest_five_wall: median(
      pairMetrics.map((metric) => metric.slowestReduction),
    ),
    total_wall: median(pairMetrics.map((metric) => metric.wallReduction)),
  });
  const gates = Object.freeze({
    accepted_to_preview: reductions.accepted_to_preview >= 0.25,
    peak_rss:
      candidateRss <= baselineRss + Math.max(baselineRss * 0.05, 64 * 2 ** 20),
    publish_to_public: reductions.publish_to_public >= 0.9,
    single_book_regression: regressedFixtureIds.length === 0,
    slowest_five_wall: reductions.slowest_five_wall >= 0.35,
    total_wall: reductions.total_wall >= 0.3,
  });
  const maximumCv = Math.max(
    coefficientOfVariation(pairMetrics.map((metric) => metric.wallRatio)),
    coefficientOfVariation(pairMetrics.map((metric) => metric.candidateRss)),
  );
  const requiresFivePairs = pairs.length === 3 && maximumCv > 0.1;
  return Object.freeze({
    fixture_count: fixtureIds.length,
    gates,
    maximum_cv: maximumCv,
    pair_count: pairs.length,
    passed: Object.values(gates).every(Boolean) && !requiresFivePairs,
    regressed_fixture_ids: Object.freeze(regressedFixtureIds),
    requires_five_pairs: requiresFivePairs,
    reductions,
  });
}
