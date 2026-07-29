import { describe, expect, it } from "vitest";

import {
  parsePairedBenchmarkReport,
  type PairedBenchmarkReport,
} from "../../../scripts/benchmarks/paired-report.js";
import {
  fixtureOrderForPair,
  parsePipelinePairedArguments,
} from "../../../scripts/benchmarks/pipeline-paired.js";
import {
  assertBenchmarkEnvironmentCompatible,
  parseBenchmarkEnvironment,
} from "../../../scripts/benchmarks/paired-environment.js";
import type { ReferenceFixtureBinding } from "../../../scripts/benchmarks/reference-preflight.js";

const fixtureOrder = Array.from(
  { length: 15 },
  (_, index) => `real-mineru-${String(index + 1).padStart(12, "0")}`,
);

function environment(schemaVersion: 1 | 2): Readonly<Record<string, unknown>> {
  const common = {
    host: {
      architecture: "x64",
      cpu_count: 8,
      cpu_models: ["test cpu"],
      memory_bytes: 16_000_000_000,
      platform: "linux",
      release: "6.1.0",
    },
    image_decoder: {
      formats: { input: ["png"], output: ["png"] },
      versions: { sharp: "0.35.3", vips: "8.18.0" },
    },
    package: { lockfile_sha256: "f".repeat(64) },
    runtime: { node: "v24.13.0", versions: { node: "24.13.0" } },
    sqlite: {
      compile_options: ["ENABLE_FTS5"],
      fts5: true,
      journal_mode: "wal",
      linked_version: "3.51.0",
      minimum_version: "3.35.0",
      source_id: "source",
      trigram: true,
    },
  };
  return schemaVersion === 1
    ? { ...common, schema_version: 1 }
    : {
        ...common,
        environment_fingerprint_sha256: "e".repeat(64),
        schema_version: 2,
        source: { commit_sha: "c".repeat(40), dirty: false },
      };
}

function report(): PairedBenchmarkReport {
  return {
    baseline_ref: "c176fddfd1e103e7c14d38b823ee2a000f6345fd",
    candidate_ref: "0123456789abcdef0123456789abcdef01234567",
    fixture_manifest_sha256: "a".repeat(64),
    order: ["AB", "BA", "AB"],
    runs: [],
    schema_version: 1,
  };
}

describe("paired benchmark report schema", () => {
  it("requires bound refs, real fixtures and a private output path", () => {
    expect(
      parsePipelinePairedArguments([
        "--baseline-ref",
        "c176fdd",
        "--candidate-ref",
        "HEAD",
        "--real-dir",
        "/tmp/real-fixtures",
        "--output",
        "/tmp/paired.json",
      ]),
    ).toMatchObject({
      baselineRef: "c176fdd",
      candidateRef: "HEAD",
      initialPairCount: 3,
      realDirectory: "/tmp/real-fixtures",
    });
    expect(() => parsePipelinePairedArguments([])).toThrow(
      "PIPELINE_PAIRED_ARGUMENT_REQUIRED",
    );
  });

  it("accepts a fully bound empty report envelope", () => {
    expect(parsePairedBenchmarkReport(report())).toEqual(report());
  });

  it("rejects missing environment and source bindings on runs", () => {
    const value = report() as unknown as Record<string, unknown>;
    value.runs = [
      {
        pair_index: 1,
        position: 1,
        variant: "baseline",
      },
    ];
    expect(() => parsePairedBenchmarkReport(value)).toThrow(
      "PAIRED_REPORT_RUN_INVALID",
    );
  });

  it("rejects unknown fields and non-alternating orders", () => {
    expect(() =>
      parsePairedBenchmarkReport({ ...report(), unexpected: true }),
    ).toThrow("PAIRED_REPORT_UNKNOWN_FIELD");
    expect(() =>
      parsePairedBenchmarkReport({ ...report(), order: ["AB", "AB", "AB"] }),
    ).toThrow("PAIRED_REPORT_ORDER_INVALID");
  });

  it("compares the stable runtime subset across environment v1 and v2", () => {
    const baseline = parseBenchmarkEnvironment(environment(1));
    const host = parseBenchmarkEnvironment(environment(2));
    expect(baseline.schema_version).toBe(1);
    expect(host.compatibility_sha256).toBe(baseline.compatibility_sha256);
    expect(() =>
      assertBenchmarkEnvironmentCompatible(host, baseline),
    ).not.toThrow();
    expect(() =>
      assertBenchmarkEnvironmentCompatible(
        host,
        parseBenchmarkEnvironment({
          ...environment(1),
          runtime: { node: "v23.0.0", versions: { node: "23.0.0" } },
        }),
      ),
    ).toThrow("PIPELINE_PAIRED_ENVIRONMENT_MISMATCH");
  });

  it("uses one deterministic shuffled fixture order per pair", () => {
    const bindings: readonly ReferenceFixtureBinding[] = fixtureOrder.map(
      (fixtureId, index) => ({
        fixture_id: fixtureId,
        reference_schema_version: 2,
        reference_sha256: index.toString(16).padStart(64, "0"),
        zip_sha256: (index + 20).toString(16).padStart(64, "0"),
      }),
    );
    const first = fixtureOrderForPair(bindings, "a".repeat(64), 1);
    expect(first).toEqual(fixtureOrderForPair(bindings, "a".repeat(64), 1));
    expect(first).not.toEqual(fixtureOrder);
    expect(fixtureOrderForPair(bindings, "a".repeat(64), 2)).not.toEqual(first);
  });
});
