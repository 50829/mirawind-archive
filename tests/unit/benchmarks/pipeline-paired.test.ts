import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  parsePairedBenchmarkReport,
  type PairedBenchmarkReport,
} from "../../../scripts/benchmarks/paired-report.js";
import {
  fixtureOrderForPair,
  loadOrCreateCorrectnessReceipt,
  parseCorrectnessReceipt,
  parsePipelinePairedArguments,
  prepareReferenceFixtureView,
} from "../../../scripts/benchmarks/pipeline-paired.js";
import {
  assertBenchmarkEnvironmentCompatible,
  parseBenchmarkEnvironment,
} from "../../../scripts/benchmarks/paired-environment.js";
import type { ReferenceFixtureBinding } from "../../../scripts/benchmarks/reference-preflight.js";
import * as referencePacks from "../../../scripts/fixtures/create-mineru-reference-pack";
import { observeRealMineruSet } from "../../../scripts/fixtures/observe-mineru-references";
import {
  mineruParagraph,
  mineruTitle,
  mineruZip,
} from "../../helpers/mineru-v2";

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

function referenceReport(): Readonly<Record<string, unknown>> {
  return {
    comparisons: fixtureOrder.map((fixtureId) => ({
      fixture_id: fixtureId,
      issues: [],
      ok: true,
    })),
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
        reference_schema_version: 3,
        reference_sha256: index.toString(16).padStart(64, "0"),
        zip_sha256: (index + 20).toString(16).padStart(64, "0"),
      }),
    );
    const first = fixtureOrderForPair(bindings, "a".repeat(64), 1);
    expect(first).toEqual(fixtureOrderForPair(bindings, "a".repeat(64), 1));
    expect(first).not.toEqual(fixtureOrder);
    expect(fixtureOrderForPair(bindings, "a".repeat(64), 2)).not.toEqual(first);
  });

  it("observes JSON content from the prepared benchmark fixture view", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-fixture-view-"));
    const fixtureId = "real-mineru-a7f31c";
    const fileName = "book.zip";
    const archive = mineruZip(
      [[mineruTitle("Book"), mineruParagraph("A complete paragraph.")]],
      [{ name: "result/book_origin.pdf", data: "%PDF synthetic" }],
    );
    const archiveSha256 = createHash("sha256").update(archive).digest("hex");
    const createPack = referencePacks.createReferencePackFromArchive;
    vi.spyOn(
      referencePacks,
      "createReferencePackFromArchive",
    ).mockImplementation((input) =>
      createPack({ ...input, pdfInspector: async () => 1 }),
    );
    try {
      await writeFile(join(root, fileName), archive);
      await writeFile(
        join(root, "selected-fixtures.json"),
        JSON.stringify({
          schema_version: 1,
          fixtures: [
            {
              file_name: fileName,
              id: fixtureId,
              mineru_version: "3.4.4",
              page_count_range: { minimum: 1, maximum: 1 },
              sha256: archiveSha256,
              size_bytes: archive.byteLength,
              usage_scope: {
                designated_by: "administrator",
                local_compatibility_testing: true,
                local_performance_testing: true,
                public_ci: false,
                redistribution: false,
                repository_storage: false,
              },
            },
          ],
        }),
      );
      const view = await prepareReferenceFixtureView({
        fixtureFiles: [{ file_name: fileName, fixture_id: fixtureId }],
        implementationRoot: fileURLToPath(
          new URL("../../../", import.meta.url),
        ),
        manifestName: "selected-fixtures.json",
        outputDirectory: join(root, "view"),
        sourceDirectory: root,
      });
      const outputDirectory = join(root, "observed");
      const summaries = await observeRealMineruSet({
        fixtureIds: [fixtureId],
        outputDirectory,
        realDirectory: view,
      });
      const observed = JSON.parse(
        await readFile(join(outputDirectory, `${fixtureId}.json`), "utf8"),
      );
      expect(summaries).toEqual([{ fixture_id: fixtureId, regions: 0 }]);
      expect(observed).toMatchObject({
        fixture_id: fixtureId,
        archive_sha256: archiveSha256,
        source_fidelity: { checked_blocks: 2, issues: [] },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reuses an exact correctness receipt only for the bound source set", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-correctness-receipt-"));
    const path = join(root, "receipt.json");
    const binding = {
      commitSha: "c".repeat(40),
      fixtureManifestSha256: "a".repeat(64),
      referenceBindingsSha256: "b".repeat(64),
    };
    let observations = 0;
    try {
      const first = await loadOrCreateCorrectnessReceipt({
        ...binding,
        createReferenceReport: async () => {
          observations += 1;
          return referenceReport();
        },
        path,
      });
      const second = await loadOrCreateCorrectnessReceipt({
        ...binding,
        createReferenceReport: async () => {
          observations += 1;
          return referenceReport();
        },
        path,
      });

      expect(observations).toBe(1);
      expect(first.exactByFixture.size).toBe(15);
      expect(second.value).toEqual(first.value);

      const receipt = JSON.parse(await readFile(path, "utf8")) as unknown;
      expect(() =>
        parseCorrectnessReceipt(receipt, {
          ...binding,
          referenceBindingsSha256: "d".repeat(64),
        }),
      ).toThrow("PIPELINE_PAIRED_CORRECTNESS_RECEIPT_BINDING_MISMATCH");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
