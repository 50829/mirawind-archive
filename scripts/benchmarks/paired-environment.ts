import { createHash } from "node:crypto";

const sha256Pattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;

export interface ParsedBenchmarkEnvironment {
  readonly compatibility_sha256: string;
  readonly environment_fingerprint_sha256: string | null;
  readonly lockfile_sha256: string;
  readonly reported_source: {
    readonly commit_sha: string;
    readonly dirty: boolean;
  } | null;
  readonly schema_version: 1 | 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_INVALID");
  }
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_INVALID");
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_INVALID");
  }
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_INVALID");
  }
  return value;
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_INVALID");
  }
  return Object.freeze([...value].sort());
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  const input = record(value);
  if (Object.values(input).some((item) => typeof item !== "string")) {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_INVALID");
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(input)
        .map(([key, item]) => [key, String(item)] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compatibilityProjection(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const host = record(value.host);
  const imageDecoder = record(value.image_decoder);
  const formats = record(imageDecoder.formats);
  const runtime = record(value.runtime);
  const sqlite = record(value.sqlite);
  return Object.freeze({
    host: Object.freeze({
      architecture: string(host.architecture),
      cpu_count: number(host.cpu_count),
      cpu_models: strings(host.cpu_models),
      memory_bytes: number(host.memory_bytes),
      platform: string(host.platform),
      release: string(host.release),
    }),
    image_decoder: Object.freeze({
      formats: Object.freeze({
        input: strings(formats.input),
        output: strings(formats.output),
      }),
      versions: stringRecord(imageDecoder.versions),
    }),
    runtime: Object.freeze({
      node: string(runtime.node),
      versions: stringRecord(runtime.versions),
    }),
    sqlite: Object.freeze({
      compile_options: strings(sqlite.compile_options),
      fts5: boolean(sqlite.fts5),
      journal_mode: string(sqlite.journal_mode),
      linked_version: string(sqlite.linked_version),
      minimum_version: string(sqlite.minimum_version),
      source_id: string(sqlite.source_id),
      trigram: boolean(sqlite.trigram),
    }),
  });
}

export function parseBenchmarkEnvironment(
  value: unknown,
): ParsedBenchmarkEnvironment {
  const input = record(value);
  if (input.schema_version !== 1 && input.schema_version !== 2) {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_INVALID");
  }
  const package_ = record(input.package);
  const lockfileSha256 = string(package_.lockfile_sha256);
  if (!sha256Pattern.test(lockfileSha256)) {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_INVALID");
  }
  const source = input.schema_version === 2 ? record(input.source) : null;
  const reportedSource = source
    ? Object.freeze({
        commit_sha: string(source.commit_sha),
        dirty: boolean(source.dirty),
      })
    : null;
  if (reportedSource && !commitPattern.test(reportedSource.commit_sha)) {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_INVALID");
  }
  const environmentFingerprint =
    input.schema_version === 2
      ? string(input.environment_fingerprint_sha256)
      : null;
  if (
    environmentFingerprint !== null &&
    !sha256Pattern.test(environmentFingerprint)
  ) {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_INVALID");
  }
  return Object.freeze({
    compatibility_sha256: sha256(
      JSON.stringify(compatibilityProjection(input)),
    ),
    environment_fingerprint_sha256: environmentFingerprint,
    lockfile_sha256: lockfileSha256,
    reported_source: reportedSource,
    schema_version: input.schema_version,
  });
}

export function assertBenchmarkEnvironmentCompatible(
  host: ParsedBenchmarkEnvironment,
  run: ParsedBenchmarkEnvironment,
): void {
  if (
    host.schema_version !== 2 ||
    host.environment_fingerprint_sha256 === null ||
    host.compatibility_sha256 !== run.compatibility_sha256
  ) {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_MISMATCH");
  }
}
