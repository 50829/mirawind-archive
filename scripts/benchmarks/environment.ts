import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { compilerIdentity } from "../../src/compiler/document/manifest.js";
import {
  assertDatabaseCapabilities,
  openDatabase,
} from "../../src/db/connection.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const packagePath = join(repositoryRoot, "package.json");
const lockfilePath = join(repositoryRoot, "pnpm-lock.yaml");

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly engines?: Readonly<Record<string, string>>;
  readonly packageManager?: string;
  readonly version?: string;
}

function sortedRecord(
  value: Readonly<Record<string, string | undefined>> | undefined,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value ?? {})
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function supportedSharpFormats(): {
  readonly input: readonly string[];
  readonly output: readonly string[];
} {
  const formats = sharp.format as unknown as Readonly<
    Record<
      string,
      {
        readonly input?: { readonly buffer?: boolean; readonly file?: boolean };
        readonly output?: {
          readonly buffer?: boolean;
          readonly file?: boolean;
        };
      }
    >
  >;
  const supports = (direction: "input" | "output"): readonly string[] =>
    Object.entries(formats)
      .filter(([, capability]) => {
        const value = capability[direction];
        return value?.buffer === true || value?.file === true;
      })
      .map(([name]) => name)
      .sort();
  return Object.freeze({
    input: supports("input"),
    output: supports("output"),
  });
}

export async function captureBenchmarkEnvironment(): Promise<
  Readonly<Record<string, unknown>>
> {
  const [packageBytes, lockfileBytes] = await Promise.all([
    readFile(packagePath),
    readFile(lockfilePath),
  ]);
  const packageManifest = JSON.parse(
    packageBytes.toString("utf8"),
  ) as PackageManifest;
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "mirawind-benchmark-environment-"),
  );
  const database = openDatabase(
    join(temporaryDirectory, "capabilities.sqlite"),
    {
      role: "worker",
    },
  );
  try {
    const databaseCapabilities = assertDatabaseCapabilities(database);
    const sqliteSource = database
      .prepare("SELECT sqlite_source_id() AS source_id")
      .get() as { source_id: string };
    const compileOptions = (
      database.pragma("compile_options") as { compile_options: string }[]
    )
      .map((row) => row.compile_options)
      .sort();
    const processorModels = [...new Set(cpus().map((cpu) => cpu.model))].sort();
    const sharpFormats = supportedSharpFormats();

    return Object.freeze({
      captured_at: new Date().toISOString(),
      compiler_identity: compilerIdentity,
      dependencies: {
        production: sortedRecord(packageManifest.dependencies),
        development: sortedRecord(packageManifest.devDependencies),
      },
      host: {
        architecture: arch(),
        cpu_count: cpus().length,
        cpu_models: processorModels,
        memory_bytes: totalmem(),
        platform: platform(),
        release: release(),
      },
      image_decoder: {
        formats: sharpFormats,
        versions: sortedRecord(
          sharp.versions as unknown as Readonly<Record<string, string>>,
        ),
      },
      package: {
        engines: sortedRecord(packageManifest.engines),
        lockfile_sha256: sha256(lockfileBytes),
        package_json_sha256: sha256(packageBytes),
        package_manager: packageManifest.packageManager ?? null,
        version: packageManifest.version ?? null,
      },
      runtime: {
        node: process.version,
        versions: sortedRecord(process.versions),
      },
      schema_version: 1,
      sqlite: {
        compile_options: compileOptions,
        fts5: databaseCapabilities.fts5,
        journal_mode: databaseCapabilities.journalMode,
        linked_version: databaseCapabilities.linkedVersion,
        minimum_version: databaseCapabilities.minimumVersion,
        source_id: sqliteSource.source_id,
        trigram: databaseCapabilities.trigram,
      },
    });
  } finally {
    database.close();
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function outputFromArguments(arguments_: readonly string[]): string | null {
  if (arguments_.length === 0) return null;
  if (arguments_.length === 2 && arguments_[0] === "--output") {
    const output = arguments_[1];
    if (output) return resolve(output);
  }
  throw new Error("Usage: environment [--output <json>]");
}

async function main(): Promise<void> {
  const output = outputFromArguments(process.argv.slice(2));
  const captured = await captureBenchmarkEnvironment();
  const json = `${JSON.stringify(captured, null, 2)}\n`;
  if (output) {
    await mkdir(dirname(output), { mode: 0o700, recursive: true });
    await writeFile(output, json, { mode: 0o600 });
  }
  process.stdout.write(json);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${
        error instanceof Error
          ? error.message
          : "Benchmark environment capture failed"
      }\n`,
    );
    process.exitCode = 1;
  });
}
