import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applySourceRegions } from "../../src/compiler/document/source-regions.js";
import type {
  ConfirmedSourceRegion,
  NormalizedDocument,
  SourcePosition,
  TransientDocumentNode,
} from "../../src/compiler/document/types.js";

const rootCounts = [500, 1_000, 2_000, 4_000] as const;

interface SourceRegionFixture {
  readonly document: NormalizedDocument;
  readonly mainMarkdownPath: string;
  readonly mainMarkdownSha256: string;
  readonly regions: readonly ConfirmedSourceRegion[];
}

export interface ComplexityMeasurement {
  readonly active_roots: number;
  readonly excluded_blocks: number;
  readonly median_ms: number;
  readonly repetitions: number;
  readonly root_count: number;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const value = sorted[Math.floor(sorted.length / 2)];
  if (value === undefined) throw new Error("COMPLEXITY_MEASUREMENTS_INVALID");
  return value;
}

function position(start: number, end: number, line: number): SourcePosition {
  return Object.freeze({
    end: Object.freeze({ column: end - start + 1, line, offset: end }),
    start: Object.freeze({ column: 1, line, offset: start }),
  });
}

export function buildSourceRegionFixture(
  rootCount: number,
): SourceRegionFixture {
  if (!Number.isSafeInteger(rootCount) || rootCount < 4) {
    throw new Error("COMPLEXITY_ROOT_COUNT_INVALID");
  }
  const parts: string[] = [];
  const roots: TransientDocumentNode[] = [];
  let offset = 0;
  for (let index = 0; index < rootCount; index += 1) {
    const text = `paragraph-${String(index).padStart(6, "0")} 中文`;
    const start = offset;
    const end = start + text.length;
    roots.push(
      Object.freeze({
        blockId: `blk_${String(index).padStart(16, "0")}`,
        position: position(start, end, index * 2 + 1),
        type: "paragraph",
        value: text,
      }),
    );
    parts.push(`${text}\n\n`);
    offset = end + 2;
  }
  const source = parts.join("");
  const sourceBytes = Buffer.from(source, "utf8");
  const excludedCount = Math.floor(rootCount / 4);
  const excludedEnd = roots[excludedCount - 1]?.position;
  if (!excludedEnd) throw new Error("COMPLEXITY_FIXTURE_INVALID");
  const endOffset = excludedEnd.end.offset;
  const endByte = Buffer.byteLength(source.slice(0, endOffset), "utf8");
  const sourceSha256 = sha256(sourceBytes);
  return Object.freeze({
    document: Object.freeze({
      blocks: Object.freeze(roots),
      headings: Object.freeze([]),
      root: Object.freeze({ children: Object.freeze(roots), type: "root" }),
      source,
    }),
    mainMarkdownPath: "source/full.md",
    mainMarkdownSha256: sourceSha256,
    regions: Object.freeze([
      Object.freeze({
        applied: true,
        disposition: "reference_only",
        entries: Object.freeze([]),
        kind: "printed_toc",
        range: Object.freeze({
          end_byte: endByte,
          sha256: sha256(sourceBytes.subarray(0, endByte)),
          start_byte: 0,
        }),
        region_id: "region_complexity0001",
        source_path: "source/full.md",
        source_sha256: sourceSha256,
      }),
    ]),
  });
}

export function runSourceRegionCase(
  rootCount: number,
  repetitions: number,
): ComplexityMeasurement {
  if (!Number.isSafeInteger(repetitions) || repetitions < 1) {
    throw new Error("COMPLEXITY_REPETITIONS_INVALID");
  }
  const fixture = buildSourceRegionFixture(rootCount);
  applySourceRegions(fixture);
  const durations: number[] = [];
  let activeRoots = 0;
  let excludedBlocks = 0;
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    const startedAt = performance.now();
    const result = applySourceRegions(fixture);
    durations.push(performance.now() - startedAt);
    activeRoots = result.document.root.children?.length ?? 0;
    excludedBlocks = result.excludedBlockIds.size;
  }
  const expectedExcluded = Math.floor(rootCount / 4);
  if (
    excludedBlocks !== expectedExcluded ||
    activeRoots !== rootCount - expectedExcluded
  ) {
    throw new Error("COMPLEXITY_OUTPUT_MISMATCH");
  }
  return Object.freeze({
    active_roots: activeRoots,
    excluded_blocks: excludedBlocks,
    median_ms: median(durations),
    repetitions,
    root_count: rootCount,
  });
}

export function evaluateSourceRegionScale(
  measurements: readonly ComplexityMeasurement[],
): { readonly passed: boolean; readonly ratio_4000_to_1000: number } {
  const oneThousand = measurements.find((item) => item.root_count === 1_000);
  const fourThousand = measurements.find((item) => item.root_count === 4_000);
  if (!oneThousand || !fourThousand || oneThousand.median_ms <= 0) {
    throw new Error("COMPLEXITY_MEASUREMENTS_INVALID");
  }
  const ratio = fourThousand.median_ms / oneThousand.median_ms;
  return Object.freeze({ passed: ratio < 6, ratio_4000_to_1000: ratio });
}

function parseArguments(arguments_: readonly string[]): {
  readonly output: string | null;
  readonly repetitions: number;
} {
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const values = new Map<string, string>();
  for (let index = 0; index < normalized.length; index += 2) {
    const name = normalized[index];
    const value = normalized[index + 1];
    if (
      !name ||
      !value ||
      !["--output", "--repetitions"].includes(name) ||
      values.has(name)
    ) {
      throw new Error("COMPLEXITY_ARGUMENT_INVALID");
    }
    values.set(name, value);
  }
  const repetitions = Number(values.get("--repetitions") ?? "5");
  if (
    !Number.isSafeInteger(repetitions) ||
    repetitions < 1 ||
    repetitions > 20
  ) {
    throw new Error("COMPLEXITY_REPETITIONS_INVALID");
  }
  const output = values.get("--output");
  return Object.freeze({
    output: output ? resolve(output) : null,
    repetitions,
  });
}

async function main(): Promise<void> {
  const input = parseArguments(process.argv.slice(2));
  const measurements = rootCounts.map((rootCount) =>
    runSourceRegionCase(rootCount, input.repetitions),
  );
  const gate = evaluateSourceRegionScale(measurements);
  const report = Object.freeze({
    captured_at: new Date().toISOString(),
    gate,
    measurements,
    schema_version: 1,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (input.output) {
    await mkdir(dirname(input.output), { mode: 0o700, recursive: true });
    await writeFile(input.output, json, { mode: 0o600 });
  }
  process.stdout.write(json);
  if (!gate.passed) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "COMPLEXITY_BENCHMARK_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
