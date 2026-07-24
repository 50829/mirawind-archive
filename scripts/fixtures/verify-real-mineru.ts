import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface RealFixture {
  readonly file_name: string;
  readonly id: string;
  readonly mineru_version: string;
  readonly page_count_range: {
    readonly maximum: number;
    readonly minimum: number;
  };
  readonly sha256: string;
  readonly size_bytes: number;
  readonly usage_scope: {
    readonly designated_by: "administrator";
    readonly local_compatibility_testing: true;
    readonly local_performance_testing: true;
    readonly public_ci: false;
    readonly redistribution: false;
    readonly repository_storage: false;
  };
}

interface RealFixtureManifest {
  readonly fixtures: readonly RealFixture[];
  readonly schema_version: 1;
}

export interface VerifiedRealFixture {
  readonly id: string;
  readonly mineruVersion: string;
  readonly pageCountRange: {
    readonly maximum: number;
    readonly minimum: number;
  };
  readonly sha256: string;
  readonly sizeBytes: number;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} contains missing or unexpected fields`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value as number;
}

const maximumSupportedZipBytes = 2 * 1024 * 1024 * 1024;

function parseFixture(value: unknown, index: number): RealFixture {
  const label = `fixtures[${index}]`;
  const input = record(value, label);
  exactKeys(
    input,
    [
      "file_name",
      "id",
      "mineru_version",
      "page_count_range",
      "sha256",
      "size_bytes",
      "usage_scope",
    ],
    label,
  );

  if (
    typeof input.id !== "string" ||
    !/^real-mineru-[a-z0-9]{6,32}$/.test(input.id)
  ) {
    throw new Error(`${label}.id must be an opaque real-mineru ID`);
  }
  if (
    typeof input.file_name !== "string" ||
    input.file_name !== `${input.id}.zip` ||
    basename(input.file_name) !== input.file_name
  ) {
    throw new Error(`${label}.file_name must be the opaque ID plus .zip`);
  }
  if (
    typeof input.mineru_version !== "string" ||
    input.mineru_version.length < 1 ||
    input.mineru_version.length > 80 ||
    /[\r\n\0]/.test(input.mineru_version)
  ) {
    throw new Error(`${label}.mineru_version is invalid`);
  }
  const sizeBytes = positiveInteger(input.size_bytes, `${label}.size_bytes`);
  if (sizeBytes > maximumSupportedZipBytes) {
    throw new Error(`${label}.size_bytes exceeds the supported ZIP limit`);
  }
  if (
    typeof input.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  ) {
    throw new Error(`${label}.sha256 must be lowercase SHA-256`);
  }

  const pageRange = record(input.page_count_range, `${label}.page_count_range`);
  exactKeys(pageRange, ["maximum", "minimum"], `${label}.page_count_range`);
  const minimum = positiveInteger(
    pageRange.minimum,
    `${label}.page_count_range.minimum`,
  );
  const maximum = positiveInteger(
    pageRange.maximum,
    `${label}.page_count_range.maximum`,
  );
  if (maximum < minimum) {
    throw new Error(`${label}.page_count_range is reversed`);
  }

  const usage = record(input.usage_scope, `${label}.usage_scope`);
  exactKeys(
    usage,
    [
      "designated_by",
      "local_compatibility_testing",
      "local_performance_testing",
      "public_ci",
      "redistribution",
      "repository_storage",
    ],
    `${label}.usage_scope`,
  );
  if (
    usage.designated_by !== "administrator" ||
    usage.local_compatibility_testing !== true ||
    usage.local_performance_testing !== true ||
    usage.public_ci !== false ||
    usage.redistribution !== false ||
    usage.repository_storage !== false
  ) {
    throw new Error(
      `${label}.usage_scope is not the approved local-only scope`,
    );
  }

  return {
    file_name: input.file_name,
    id: input.id,
    mineru_version: input.mineru_version,
    page_count_range: { maximum, minimum },
    sha256: input.sha256,
    size_bytes: sizeBytes,
    usage_scope: {
      designated_by: "administrator",
      local_compatibility_testing: true,
      local_performance_testing: true,
      public_ci: false,
      redistribution: false,
      repository_storage: false,
    },
  };
}

export function parseRealFixtureManifest(value: unknown): RealFixtureManifest {
  const input = record(value, "manifest");
  exactKeys(input, ["fixtures", "schema_version"], "manifest");
  if (input.schema_version !== 1) {
    throw new Error("manifest.schema_version must be 1");
  }
  if (
    !Array.isArray(input.fixtures) ||
    input.fixtures.length < 2 ||
    input.fixtures.length > 3
  ) {
    throw new Error("manifest.fixtures must contain two or three entries");
  }
  const fixtures = input.fixtures.map(parseFixture);
  if (new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length) {
    throw new Error("manifest fixture IDs must be unique");
  }
  return { fixtures, schema_version: 1 };
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function verifyRealMineruFixtures(
  directoryInput: string,
  manifestInput?: string,
): Promise<readonly VerifiedRealFixture[]> {
  if (!isAbsolute(directoryInput)) {
    throw new Error("Real fixture directory must be absolute");
  }
  let directory: string;
  try {
    directory = await realpath(resolve(directoryInput));
  } catch (cause) {
    throw new Error("Real fixture directory is missing or inaccessible", {
      cause,
    });
  }
  const manifestPath = resolve(
    directory,
    manifestInput ?? "real-fixtures.json",
  );
  if (dirname(manifestPath) !== directory) {
    throw new Error(
      "Real fixture manifest must be directly inside the directory",
    );
  }
  let manifestLink;
  try {
    manifestLink = await lstat(manifestPath);
  } catch (cause) {
    throw new Error("Real fixture manifest is missing or inaccessible", {
      cause,
    });
  }
  if (!manifestLink.isFile() || manifestLink.isSymbolicLink()) {
    throw new Error("Real fixture manifest must be a regular non-symlink file");
  }
  const manifest = parseRealFixtureManifest(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );

  const verified: VerifiedRealFixture[] = [];
  for (const fixture of manifest.fixtures) {
    const path = join(directory, fixture.file_name);
    const link = await lstat(path);
    if (!link.isFile() || link.isSymbolicLink()) {
      throw new Error(`${fixture.id} must be a regular non-symlink file`);
    }
    const canonicalPath = await realpath(path);
    if (dirname(canonicalPath) !== directory) {
      throw new Error(`${fixture.id} resolves outside the fixture directory`);
    }
    const metadata = await stat(canonicalPath);
    if (metadata.size !== fixture.size_bytes) {
      throw new Error(`${fixture.id} size does not match its manifest`);
    }
    if ((await sha256(canonicalPath)) !== fixture.sha256) {
      throw new Error(`${fixture.id} SHA-256 does not match its manifest`);
    }
    verified.push(
      Object.freeze({
        id: fixture.id,
        mineruVersion: fixture.mineru_version,
        pageCountRange: Object.freeze({ ...fixture.page_count_range }),
        sha256: fixture.sha256,
        sizeBytes: fixture.size_bytes,
      }),
    );
  }
  return Object.freeze(verified);
}

function parseArguments(arguments_: readonly string[]): {
  readonly directory: string;
  readonly manifest?: string;
} {
  let directory: string | undefined;
  let manifest: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dir") directory = arguments_[++index];
    else if (argument === "--manifest") manifest = arguments_[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!directory) {
    throw new Error("Usage: verify-real-mineru --dir <absolute-directory>");
  }
  return {
    directory,
    ...(manifest ? { manifest } : {}),
  };
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const verified = await verifyRealMineruFixtures(
    arguments_.directory,
    arguments_.manifest,
  );
  process.stdout.write(
    `${JSON.stringify({
      fixtures: verified,
      status: "verified",
    })}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Fixture verification failed"}\n`,
    );
    process.exitCode = 1;
  });
}
