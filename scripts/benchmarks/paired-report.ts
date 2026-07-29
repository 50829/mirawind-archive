const sha1Pattern = /^[a-f0-9]{40}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const fixtureIdPattern = /^real-mineru-[a-z0-9]{6,32}$/u;

export type PairOrder = "AB" | "BA";
export type BenchmarkVariant = "baseline" | "candidate";

export interface FixtureMeasurement {
  readonly accepted_to_preview_ms: number;
  readonly fixture_id: string;
  readonly peak_process_tree_rss_bytes: number;
  readonly publish_to_public_ms: number;
  readonly reference_exact: boolean;
  readonly status: "passed";
  readonly wall_ms: number;
}

export interface BenchmarkRun {
  readonly commit_sha: string;
  readonly dirty: boolean;
  readonly environment_sha256: string;
  readonly fixture_order: readonly string[];
  readonly fixture_manifest_sha256: string;
  readonly lockfile_sha256: string;
  readonly measurements: readonly FixtureMeasurement[];
  readonly order: PairOrder;
  readonly pair_index: number;
  readonly position: number;
  readonly reference_report_sha256: string;
  readonly raw_environment_report_sha256: string;
  readonly variant: BenchmarkVariant;
}

export interface PairedBenchmarkReport {
  readonly baseline_ref: string;
  readonly candidate_ref: string;
  readonly fixture_manifest_sha256: string;
  readonly order: readonly PairOrder[];
  readonly runs: readonly BenchmarkRun[];
  readonly schema_version: 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  errorCode: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(errorCode);
  }
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseMeasurement(value: unknown): FixtureMeasurement {
  if (!isRecord(value)) throw new Error("PAIRED_REPORT_MEASUREMENT_INVALID");
  exactKeys(
    value,
    [
      "accepted_to_preview_ms",
      "fixture_id",
      "peak_process_tree_rss_bytes",
      "publish_to_public_ms",
      "reference_exact",
      "status",
      "wall_ms",
    ],
    "PAIRED_REPORT_MEASUREMENT_INVALID",
  );
  if (
    typeof value.fixture_id !== "string" ||
    !fixtureIdPattern.test(value.fixture_id) ||
    !finiteNonnegative(value.accepted_to_preview_ms) ||
    !finiteNonnegative(value.publish_to_public_ms) ||
    !finiteNonnegative(value.wall_ms) ||
    !finiteNonnegative(value.peak_process_tree_rss_bytes) ||
    typeof value.reference_exact !== "boolean" ||
    value.status !== "passed"
  ) {
    throw new Error("PAIRED_REPORT_MEASUREMENT_INVALID");
  }
  return Object.freeze({
    accepted_to_preview_ms: value.accepted_to_preview_ms,
    fixture_id: value.fixture_id,
    peak_process_tree_rss_bytes: value.peak_process_tree_rss_bytes,
    publish_to_public_ms: value.publish_to_public_ms,
    reference_exact: value.reference_exact,
    status: value.status,
    wall_ms: value.wall_ms,
  });
}

export function parseBenchmarkRun(value: unknown): BenchmarkRun {
  if (!isRecord(value)) throw new Error("PAIRED_REPORT_RUN_INVALID");
  exactKeys(
    value,
    [
      "commit_sha",
      "dirty",
      "environment_sha256",
      "fixture_order",
      "fixture_manifest_sha256",
      "lockfile_sha256",
      "measurements",
      "order",
      "pair_index",
      "position",
      "reference_report_sha256",
      "raw_environment_report_sha256",
      "variant",
    ],
    "PAIRED_REPORT_RUN_INVALID",
  );
  const fixtureOrder = Array.isArray(value.fixture_order)
    ? value.fixture_order
    : null;
  if (
    typeof value.commit_sha !== "string" ||
    !sha1Pattern.test(value.commit_sha) ||
    typeof value.dirty !== "boolean" ||
    typeof value.environment_sha256 !== "string" ||
    !sha256Pattern.test(value.environment_sha256) ||
    typeof value.fixture_manifest_sha256 !== "string" ||
    !sha256Pattern.test(value.fixture_manifest_sha256) ||
    typeof value.lockfile_sha256 !== "string" ||
    !sha256Pattern.test(value.lockfile_sha256) ||
    !Array.isArray(value.measurements) ||
    (value.order !== "AB" && value.order !== "BA") ||
    !Number.isSafeInteger(value.pair_index) ||
    Number(value.pair_index) < 1 ||
    !Number.isSafeInteger(value.position) ||
    ![1, 2].includes(Number(value.position)) ||
    typeof value.reference_report_sha256 !== "string" ||
    !sha256Pattern.test(value.reference_report_sha256) ||
    typeof value.raw_environment_report_sha256 !== "string" ||
    !sha256Pattern.test(value.raw_environment_report_sha256) ||
    fixtureOrder === null ||
    fixtureOrder.length !== 15 ||
    fixtureOrder.some(
      (fixtureId) =>
        typeof fixtureId !== "string" || !fixtureIdPattern.test(fixtureId),
    ) ||
    new Set(fixtureOrder).size !== 15 ||
    (value.variant !== "baseline" && value.variant !== "candidate")
  ) {
    throw new Error("PAIRED_REPORT_RUN_INVALID");
  }
  const expectedPosition =
    value.order.indexOf(value.variant === "baseline" ? "A" : "B") + 1;
  if (value.position !== expectedPosition) {
    throw new Error("PAIRED_REPORT_RUN_INVALID");
  }
  const measurements = Object.freeze(value.measurements.map(parseMeasurement));
  if (
    measurements.length !== fixtureOrder.length ||
    measurements.some(
      (measurement, index) => measurement.fixture_id !== fixtureOrder[index],
    )
  ) {
    throw new Error("PAIRED_REPORT_RUN_INVALID");
  }
  return Object.freeze({
    commit_sha: value.commit_sha,
    dirty: value.dirty,
    environment_sha256: value.environment_sha256,
    fixture_order: Object.freeze([...fixtureOrder] as string[]),
    fixture_manifest_sha256: value.fixture_manifest_sha256,
    lockfile_sha256: value.lockfile_sha256,
    measurements,
    order: value.order,
    pair_index: Number(value.pair_index),
    position: Number(value.position),
    reference_report_sha256: value.reference_report_sha256,
    raw_environment_report_sha256: value.raw_environment_report_sha256,
    variant: value.variant,
  });
}

function parseOrder(value: unknown): readonly PairOrder[] {
  if (!Array.isArray(value) || ![3, 5].includes(value.length)) {
    throw new Error("PAIRED_REPORT_ORDER_INVALID");
  }
  const result = value.map((item, index) => {
    const expected = index % 2 === 0 ? "AB" : "BA";
    if (item !== expected) throw new Error("PAIRED_REPORT_ORDER_INVALID");
    return expected;
  });
  return Object.freeze(result);
}

export function parsePairedBenchmarkReport(
  value: unknown,
): PairedBenchmarkReport {
  if (!isRecord(value)) throw new Error("PAIRED_REPORT_INVALID");
  const expectedKeys = [
    "baseline_ref",
    "candidate_ref",
    "fixture_manifest_sha256",
    "order",
    "runs",
    "schema_version",
  ];
  exactKeys(value, expectedKeys, "PAIRED_REPORT_UNKNOWN_FIELD");
  if (
    typeof value.baseline_ref !== "string" ||
    !sha1Pattern.test(value.baseline_ref) ||
    typeof value.candidate_ref !== "string" ||
    !sha1Pattern.test(value.candidate_ref) ||
    typeof value.fixture_manifest_sha256 !== "string" ||
    !sha256Pattern.test(value.fixture_manifest_sha256) ||
    value.schema_version !== 1 ||
    !Array.isArray(value.runs)
  ) {
    throw new Error("PAIRED_REPORT_INVALID");
  }
  const order = parseOrder(value.order);
  const runs = Object.freeze(value.runs.map(parseBenchmarkRun));
  if (runs.length !== 0 && runs.length !== order.length * 2) {
    throw new Error("PAIRED_REPORT_RUN_COUNT_INVALID");
  }
  for (const run of runs) {
    if (
      run.fixture_manifest_sha256 !== value.fixture_manifest_sha256 ||
      run.commit_sha !==
        (run.variant === "baseline"
          ? value.baseline_ref
          : value.candidate_ref) ||
      run.order !== order[run.pair_index - 1]
    ) {
      throw new Error("PAIRED_REPORT_RUN_BINDING_INVALID");
    }
  }
  return Object.freeze({
    baseline_ref: value.baseline_ref,
    candidate_ref: value.candidate_ref,
    fixture_manifest_sha256: value.fixture_manifest_sha256,
    order,
    runs,
    schema_version: 1,
  });
}
