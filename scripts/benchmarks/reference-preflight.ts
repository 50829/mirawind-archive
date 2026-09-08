const fixtureIdPattern = /^real-mineru-[a-z0-9]{6,32}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export interface ReferenceFixtureBinding {
  readonly fixture_id: string;
  readonly reference_schema_version: 3;
  readonly reference_sha256: string;
  readonly zip_sha256: string;
}

export interface ReferenceFixtureFile {
  readonly file_name: string;
  readonly fixture_id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

export function assertReferencePreflight(
  value: unknown,
): readonly ReferenceFixtureBinding[] {
  if (!Array.isArray(value) || value.length !== 15) {
    throw new Error("REFERENCE_PREFLIGHT_COUNT_INVALID");
  }
  const result = value.map((item) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, [
        "fixture_id",
        "reference_schema_version",
        "reference_sha256",
        "zip_sha256",
      ]) ||
      typeof item.fixture_id !== "string" ||
      !fixtureIdPattern.test(item.fixture_id) ||
      item.reference_schema_version !== 3 ||
      typeof item.reference_sha256 !== "string" ||
      !sha256Pattern.test(item.reference_sha256) ||
      typeof item.zip_sha256 !== "string" ||
      !sha256Pattern.test(item.zip_sha256)
    ) {
      throw new Error(
        item.reference_schema_version === 3
          ? "REFERENCE_PREFLIGHT_BINDING_INVALID"
          : "REFERENCE_PREFLIGHT_SCHEMA_INVALID",
      );
    }
    return Object.freeze({
      fixture_id: item.fixture_id,
      reference_schema_version: 3 as const,
      reference_sha256: item.reference_sha256,
      zip_sha256: item.zip_sha256,
    });
  });
  const unique = (select: (item: ReferenceFixtureBinding) => string) =>
    new Set(result.map(select)).size === result.length;
  if (
    !unique((item) => item.fixture_id) ||
    !unique((item) => item.reference_sha256) ||
    !unique((item) => item.zip_sha256)
  ) {
    throw new Error("REFERENCE_PREFLIGHT_DUPLICATE");
  }
  return Object.freeze(
    result.toSorted((left, right) =>
      left.fixture_id.localeCompare(right.fixture_id),
    ),
  );
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadReferencePreflight(input: {
  readonly realDirectory: string;
  readonly realManifest: string;
}): Promise<{
  readonly bindings: readonly ReferenceFixtureBinding[];
  readonly fixtureFiles: readonly ReferenceFixtureFile[];
  readonly manifestSha256: string;
}> {
  const fixtures = await verifyRealMineruFixtures(
    input.realDirectory,
    input.realManifest,
  );
  if (fixtures.length !== 15) {
    throw new Error("REFERENCE_PREFLIGHT_COUNT_INVALID");
  }
  const manifestBytes = await readFile(
    join(input.realDirectory, input.realManifest),
  );
  const bindings = await Promise.all(
    fixtures.map(async (fixture) => {
      const referenceBytes = await readFile(
        join(input.realDirectory, "references-v3", `${fixture.id}.json`),
      );
      const reference = JSON.parse(referenceBytes.toString("utf8")) as unknown;
      if (
        !isObject(reference) ||
        reference.schema_version !== 3 ||
        reference.archive_sha256 !== fixture.sha256
      ) {
        throw new Error("REFERENCE_PREFLIGHT_BINDING_INVALID");
      }
      return Object.freeze({
        fixture_id: fixture.id,
        reference_schema_version: 3 as const,
        reference_sha256: sha256(referenceBytes),
        zip_sha256: fixture.sha256,
      });
    }),
  );
  return Object.freeze({
    bindings: assertReferencePreflight(bindings),
    fixtureFiles: Object.freeze(
      fixtures.map((fixture) =>
        Object.freeze({
          file_name: fixture.fileName,
          fixture_id: fixture.id,
        }),
      ),
    ),
    manifestSha256: sha256(manifestBytes),
  });
}

function parseArguments(arguments_: readonly string[]): {
  readonly baselineRef: string;
  readonly output: string;
  readonly realDirectory: string;
  readonly realManifest: string;
} {
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const values = new Map<string, string>();
  for (let index = 0; index < normalized.length; index += 2) {
    const name = normalized[index];
    const value = normalized[index + 1];
    if (
      !name ||
      !value ||
      !["--baseline-ref", "--output", "--real-dir", "--real-manifest"].includes(
        name,
      ) ||
      values.has(name)
    ) {
      throw new Error("REFERENCE_PREFLIGHT_ARGUMENT_INVALID");
    }
    values.set(name, value);
  }
  const baselineRef = values.get("--baseline-ref");
  const output = values.get("--output");
  const realDirectory = values.get("--real-dir");
  if (
    !baselineRef ||
    !/^[a-f0-9]{40}$/u.test(baselineRef) ||
    !output ||
    !realDirectory
  ) {
    throw new Error("REFERENCE_PREFLIGHT_ARGUMENT_REQUIRED");
  }
  return Object.freeze({
    baselineRef,
    output: resolve(output),
    realDirectory: resolve(realDirectory),
    realManifest: values.get("--real-manifest") ?? "real-fixtures.json",
  });
}

async function main(): Promise<void> {
  const input = parseArguments(process.argv.slice(2));
  const preflight = await loadReferencePreflight(input);
  const report = Object.freeze({
    baseline_ref: input.baselineRef,
    fixture_manifest_sha256: preflight.manifestSha256,
    fixtures: preflight.bindings,
    schema_version: 1,
  });
  await mkdir(dirname(input.output), { mode: 0o700, recursive: true });
  await writeFile(input.output, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({ fixture_count: preflight.bindings.length, ok: true })}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "REFERENCE_PREFLIGHT_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyRealMineruFixtures } from "../fixtures/verify-real-mineru.js";
