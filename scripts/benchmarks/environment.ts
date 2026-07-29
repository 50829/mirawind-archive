import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import sharp from "sharp";

import { compilerIdentity } from "../../src/compiler/document/manifest.js";
import {
  assertDatabaseCapabilities,
  openDatabase,
} from "../../src/db/connection.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const packagePath = join(repositoryRoot, "package.json");
const lockfilePath = join(repositoryRoot, "pnpm-lock.yaml");
const execFileAsync = promisify(execFile);

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

async function git(arguments_: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

function decodeMountPath(value: string): string {
  return value.replaceAll(/\\([0-7]{3})/gu, (_, octal: string) =>
    String.fromCodePoint(Number.parseInt(octal, 8)),
  );
}

async function filesystemEnvironment(): Promise<
  Readonly<Record<string, unknown>>
> {
  const stats = await statfs(repositoryRoot);
  if (process.platform !== "linux") {
    return Object.freeze({
      block_size: stats.bsize,
      filesystem_type: String(stats.type),
      mount_options: [],
      mount_point: null,
    });
  }
  const mountInfo = await readFile("/proc/self/mountinfo", "utf8");
  const candidates = mountInfo
    .split("\n")
    .flatMap((line) => {
      const [left, right] = line.split(" - ");
      if (!left || !right) return [];
      const leftFields = left.split(" ");
      const rightFields = right.split(" ");
      const mountPoint = leftFields[4]
        ? decodeMountPath(leftFields[4])
        : undefined;
      if (
        !mountPoint ||
        (repositoryRoot !== mountPoint &&
          !repositoryRoot.startsWith(`${mountPoint}/`))
      ) {
        return [];
      }
      return [
        {
          filesystemType: rightFields[0] ?? null,
          mountOptions: [
            ...new Set([
              ...(leftFields[5]?.split(",") ?? []),
              ...(rightFields[2]?.split(",") ?? []),
            ]),
          ]
            .filter(Boolean)
            .toSorted(),
          mountPoint,
        },
      ];
    })
    .toSorted(
      (left, right) => right.mountPoint.length - left.mountPoint.length,
    );
  const selected = candidates[0];
  return Object.freeze({
    block_size: stats.bsize,
    filesystem_type: selected?.filesystemType ?? String(stats.type),
    mount_options: selected?.mountOptions ?? [],
    mount_point: selected?.mountPoint ?? null,
  });
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
    const [commitSha, status, filesystem] = await Promise.all([
      git(["rev-parse", "HEAD"]),
      git(["status", "--porcelain=v1", "--untracked-files=no"]),
      filesystemEnvironment(),
    ]);
    const host = Object.freeze({
      architecture: arch(),
      cpu_count: cpus().length,
      cpu_models: processorModels,
      filesystem,
      memory_bytes: totalmem(),
      platform: platform(),
      release: release(),
    });
    const sharpCache = sharp.cache();
    const imageDecoder = Object.freeze({
      cache: sharpCache,
      concurrency: sharp.concurrency(),
      formats: sharpFormats,
      versions: sortedRecord(
        sharp.versions as unknown as Readonly<Record<string, string>>,
      ),
    });
    const runtime = Object.freeze({
      malloc_arena_max: process.env.MALLOC_ARENA_MAX ?? null,
      node: process.version,
      uv_threadpool_size: process.env.UV_THREADPOOL_SIZE ?? null,
      versions: sortedRecord(process.versions),
    });
    const sqlite = Object.freeze({
      compile_options: compileOptions,
      fts5: databaseCapabilities.fts5,
      journal_mode: databaseCapabilities.journalMode,
      linked_version: databaseCapabilities.linkedVersion,
      minimum_version: databaseCapabilities.minimumVersion,
      source_id: sqliteSource.source_id,
      trigram: databaseCapabilities.trigram,
    });
    const fingerprintImageDecoder = Object.freeze({
      cache_limits: Object.freeze({
        files: sharpCache.files.max,
        items: sharpCache.items.max,
        memory: sharpCache.memory.max,
      }),
      concurrency: imageDecoder.concurrency,
      formats: imageDecoder.formats,
      versions: imageDecoder.versions,
    });
    const environmentFingerprint = sha256(
      JSON.stringify({
        host,
        image_decoder: fingerprintImageDecoder,
        runtime,
        sqlite,
      }),
    );

    return Object.freeze({
      captured_at: new Date().toISOString(),
      compiler_identity: compilerIdentity,
      dependencies: {
        production: sortedRecord(packageManifest.dependencies),
        development: sortedRecord(packageManifest.devDependencies),
      },
      environment_fingerprint_sha256: environmentFingerprint,
      host,
      image_decoder: imageDecoder,
      package: {
        engines: sortedRecord(packageManifest.engines),
        lockfile_sha256: sha256(lockfileBytes),
        package_json_sha256: sha256(packageBytes),
        package_manager: packageManifest.packageManager ?? null,
        version: packageManifest.version ?? null,
      },
      runtime,
      source: {
        commit_sha: commitSha,
        dirty: status.length > 0,
      },
      schema_version: 2,
      sqlite,
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
