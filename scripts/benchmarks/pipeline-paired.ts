import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  parseBenchmarkRun,
  parsePairedBenchmarkReport,
  type BenchmarkRun,
  type BenchmarkVariant,
  type FixtureMeasurement,
  type PairOrder,
  type PairedBenchmarkReport,
} from "./paired-report.js";
import { evaluatePairedPerformance } from "./paired-statistics.js";
import {
  assertBenchmarkEnvironmentCompatible,
  parseBenchmarkEnvironment,
  type ParsedBenchmarkEnvironment,
} from "./paired-environment.js";
import {
  loadReferencePreflight,
  type ReferenceFixtureBinding,
  type ReferenceFixtureFile,
} from "./reference-preflight.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const commitPattern = /^[a-f0-9]{40}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const maximumCommandTail = 64 * 1024;

export interface PipelinePairedArguments {
  readonly baselineRef: string;
  readonly candidateRef: string;
  readonly initialPairCount: 3;
  readonly output: string;
  readonly realDirectory: string;
  readonly realManifest: string;
}

interface PreparedWorktree {
  readonly commitSha: string;
  readonly path: string;
  readonly variant: BenchmarkVariant;
}

interface ReferencePackModule {
  readonly createReferencePackFromArchive: (input: {
    readonly archivePath: string;
    readonly fixtureId: string;
    readonly outputDirectory: string;
    readonly pageIndices: readonly number[];
  }) => Promise<unknown>;
}

function argumentMap(
  arguments_: readonly string[],
): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !name ||
      !value ||
      ![
        "--baseline-ref",
        "--candidate-ref",
        "--output",
        "--real-dir",
        "--real-manifest",
      ].includes(name) ||
      values.has(name)
    ) {
      throw new Error("PIPELINE_PAIRED_ARGUMENT_INVALID");
    }
    values.set(name, value);
  }
  return values;
}

export function parsePipelinePairedArguments(
  arguments_: readonly string[],
): PipelinePairedArguments {
  const values = argumentMap(arguments_);
  const baselineRef = values.get("--baseline-ref");
  const candidateRef = values.get("--candidate-ref");
  const output = values.get("--output");
  const realDirectory = values.get("--real-dir");
  if (!baselineRef || !candidateRef || !output || !realDirectory) {
    throw new Error("PIPELINE_PAIRED_ARGUMENT_REQUIRED");
  }
  return Object.freeze({
    baselineRef,
    candidateRef,
    initialPairCount: 3 as const,
    output: resolve(output),
    realDirectory: resolve(realDirectory),
    realManifest: values.get("--real-manifest") ?? "real-fixtures.json",
  });
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runCommand(input: {
  readonly arguments: readonly string[];
  readonly command: string;
  readonly cwd: string;
}): Promise<string> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(input.command, input.arguments, {
      cwd: input.cwd,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const append = (chunk: Buffer) => {
      tail = `${tail}${chunk.toString("utf8")}`.slice(-maximumCommandTail);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", rejectCommand);
    child.once("close", (code, signal) => {
      if (code === 0) resolveCommand(tail);
      else {
        rejectCommand(
          new Error(
            `PIPELINE_PAIRED_COMMAND_FAILED:${input.command}:${String(code)}:${String(signal)}\n${tail}`,
          ),
        );
      }
    });
  });
}

async function git(
  arguments_: readonly string[],
  cwd = repositoryRoot,
): Promise<string> {
  return (
    await runCommand({ arguments: arguments_, command: "git", cwd })
  ).trim();
}

async function resolveCommit(reference: string): Promise<string> {
  const commit = await git(["rev-parse", "--verify", `${reference}^{commit}`]);
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("PIPELINE_PAIRED_COMMIT_INVALID");
  }
  return commit;
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

async function addWorktree(input: {
  readonly commitSha: string;
  readonly root: string;
  readonly variant: BenchmarkVariant;
}): Promise<PreparedWorktree> {
  const path = join(input.root, input.variant);
  await git(["worktree", "add", "--detach", path, input.commitSha]);
  return Object.freeze({
    commitSha: input.commitSha,
    path,
    variant: input.variant,
  });
}

async function removeWorktree(path: string): Promise<void> {
  await git(["worktree", "remove", "--force", path]).catch(() => undefined);
}

async function prepareWorktree(worktree: PreparedWorktree): Promise<void> {
  await runCommand({
    arguments: ["install", "--frozen-lockfile", "--offline"],
    command: "pnpm",
    cwd: worktree.path,
  });
  await runCommand({
    arguments: ["build"],
    command: "pnpm",
    cwd: worktree.path,
  });
}

async function linkOrCopy(source: string, destination: string): Promise<void> {
  await link(source, destination).catch(async (error: unknown) => {
    if (
      !isRecord(error) ||
      !["EXDEV", "EPERM", "EOPNOTSUPP"].includes(String(error.code))
    ) {
      throw error;
    }
    await copyFile(source, destination);
  });
}

export async function prepareReferenceFixtureView(input: {
  readonly fixtureFiles: readonly ReferenceFixtureFile[];
  readonly implementationRoot: string;
  readonly manifestName: string;
  readonly outputDirectory: string;
  readonly sourceDirectory: string;
}): Promise<string> {
  const outputDirectory = resolve(input.outputDirectory);
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(join(outputDirectory, "reference-packs-v2"), {
    mode: 0o700,
    recursive: true,
  });
  await copyFile(
    join(input.sourceDirectory, input.manifestName),
    join(outputDirectory, input.manifestName),
  );
  if (input.manifestName !== "real-fixtures.json") {
    await copyFile(
      join(input.sourceDirectory, input.manifestName),
      join(outputDirectory, "real-fixtures.json"),
    );
  }
  for (const fixture of input.fixtureFiles) {
    await linkOrCopy(
      join(input.sourceDirectory, fixture.file_name),
      join(outputDirectory, fixture.file_name),
    );
  }
  const packModule = (await import(
    pathToFileURL(
      join(
        input.implementationRoot,
        "scripts/fixtures/create-mineru-reference-pack.ts",
      ),
    ).href
  )) as ReferencePackModule;
  for (const fixture of input.fixtureFiles) {
    await packModule.createReferencePackFromArchive({
      archivePath: join(outputDirectory, fixture.file_name),
      fixtureId: fixture.fixture_id,
      outputDirectory: join(
        outputDirectory,
        "reference-packs-v2",
        fixture.fixture_id,
      ),
      pageIndices: Object.freeze([]),
    });
  }
  return outputDirectory;
}

export function fixtureOrderForPair(
  bindings: readonly ReferenceFixtureBinding[],
  manifestSha256: string,
  pairIndex: number,
): readonly string[] {
  if (!sha256Pattern.test(manifestSha256) || !Number.isSafeInteger(pairIndex)) {
    throw new Error("PIPELINE_PAIRED_FIXTURE_ORDER_INVALID");
  }
  return Object.freeze(
    bindings
      .map((binding) => binding.fixture_id)
      .toSorted((left, right) => {
        const leftRank = sha256(
          `${manifestSha256}:${String(pairIndex)}:${left}`,
        );
        const rightRank = sha256(
          `${manifestSha256}:${String(pairIndex)}:${right}`,
        );
        return leftRank.localeCompare(rightRank) || left.localeCompare(right);
      }),
  );
}

export interface ParsedReferenceReport {
  readonly exactByFixture: ReadonlyMap<string, boolean>;
  readonly ok: boolean;
  readonly value: Readonly<Record<string, unknown>>;
}

function parseReferenceReport(value: unknown): ParsedReferenceReport {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    !Array.isArray(value.comparisons)
  ) {
    throw new Error("PIPELINE_PAIRED_REFERENCE_REPORT_INVALID");
  }
  const entries = value.comparisons.map((comparison) => {
    if (
      !isRecord(comparison) ||
      typeof comparison.fixture_id !== "string" ||
      typeof comparison.ok !== "boolean" ||
      !Array.isArray(comparison.issues)
    ) {
      throw new Error("PIPELINE_PAIRED_REFERENCE_REPORT_INVALID");
    }
    return [
      comparison.fixture_id,
      comparison.ok && comparison.issues.length === 0,
    ] as const;
  });
  if (entries.length !== 15 || new Set(entries.map(([id]) => id)).size !== 15) {
    throw new Error("PIPELINE_PAIRED_REFERENCE_REPORT_INVALID");
  }
  const exactByFixture = new Map(entries);
  return Object.freeze({
    exactByFixture,
    ok: entries.every(([, exact]) => exact),
    value: Object.freeze({ ...value }),
  });
}

export function parseCorrectnessReceipt(
  value: unknown,
  expected: {
    readonly commitSha: string;
    readonly fixtureManifestSha256: string;
    readonly referenceBindingsSha256: string;
  },
): ParsedReferenceReport {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !==
      "commit_sha,fixture_manifest_sha256,reference_bindings_sha256,reference_report,schema_version" ||
    value.schema_version !== 1 ||
    typeof value.commit_sha !== "string" ||
    !commitPattern.test(value.commit_sha) ||
    typeof value.fixture_manifest_sha256 !== "string" ||
    !sha256Pattern.test(value.fixture_manifest_sha256) ||
    typeof value.reference_bindings_sha256 !== "string" ||
    !sha256Pattern.test(value.reference_bindings_sha256)
  ) {
    throw new Error("PIPELINE_PAIRED_CORRECTNESS_RECEIPT_INVALID");
  }
  if (
    value.commit_sha !== expected.commitSha ||
    value.fixture_manifest_sha256 !== expected.fixtureManifestSha256 ||
    value.reference_bindings_sha256 !== expected.referenceBindingsSha256
  ) {
    throw new Error("PIPELINE_PAIRED_CORRECTNESS_RECEIPT_BINDING_MISMATCH");
  }
  const report = parseReferenceReport(value.reference_report);
  if (!report.ok) {
    throw new Error("PIPELINE_PAIRED_CORRECTNESS_RECEIPT_INVALID");
  }
  return report;
}

async function loadCorrectnessReceipt(input: {
  readonly commitSha: string;
  readonly fixtureManifestSha256: string;
  readonly path: string;
  readonly referenceBindingsSha256: string;
}): Promise<ParsedReferenceReport | null> {
  const bytes = await readFile(input.path).catch((error: unknown) => {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  });
  if (bytes === null) return null;
  return parseCorrectnessReceipt(
    JSON.parse(bytes.toString("utf8")) as unknown,
    {
      commitSha: input.commitSha,
      fixtureManifestSha256: input.fixtureManifestSha256,
      referenceBindingsSha256: input.referenceBindingsSha256,
    },
  );
}

async function writeCorrectnessReceipt(input: {
  readonly commitSha: string;
  readonly fixtureManifestSha256: string;
  readonly path: string;
  readonly referenceBindingsSha256: string;
  readonly referenceReport: Readonly<Record<string, unknown>>;
}): Promise<void> {
  await atomicJson(input.path, {
    commit_sha: input.commitSha,
    fixture_manifest_sha256: input.fixtureManifestSha256,
    reference_bindings_sha256: input.referenceBindingsSha256,
    reference_report: input.referenceReport,
    schema_version: 1,
  });
}

export async function loadOrCreateCorrectnessReceipt(input: {
  readonly commitSha: string;
  readonly createReferenceReport: () => Promise<unknown>;
  readonly fixtureManifestSha256: string;
  readonly path: string;
  readonly referenceBindingsSha256: string;
}): Promise<ParsedReferenceReport> {
  const existing = await loadCorrectnessReceipt(input);
  if (existing) return existing;

  const report = parseReferenceReport(await input.createReferenceReport());
  if (!report.ok) {
    throw new Error("PIPELINE_PAIRED_CORRECTNESS_RECEIPT_INVALID");
  }
  await writeCorrectnessReceipt({
    commitSha: input.commitSha,
    fixtureManifestSha256: input.fixtureManifestSha256,
    path: input.path,
    referenceBindingsSha256: input.referenceBindingsSha256,
    referenceReport: report.value,
  });
  return report;
}

function parseMeasurements(
  value: unknown,
  exactByFixture: ReadonlyMap<string, boolean>,
): readonly FixtureMeasurement[] {
  if (
    !isRecord(value) ||
    value.status !== "passed" ||
    !Array.isArray(value.results)
  ) {
    throw new Error("PIPELINE_PAIRED_PROFILE_INVALID");
  }
  const measurements = value.results.map((item) => {
    if (
      !isRecord(item) ||
      item.status !== "passed" ||
      item.fixture_type !== "real" ||
      typeof item.fixture_id !== "string" ||
      !isRecord(item.timings) ||
      !isRecord(item.memory)
    ) {
      throw new Error("PIPELINE_PAIRED_PROFILE_INVALID");
    }
    const metrics = [
      item.timings.accepted_to_preview_ms,
      item.timings.publish_requested_to_public_ms,
      item.timings.wall_ms,
      item.memory.peak_process_tree_rss_bytes,
    ];
    if (
      metrics.some(
        (metric) =>
          typeof metric !== "number" || !Number.isFinite(metric) || metric < 0,
      )
    ) {
      throw new Error("PIPELINE_PAIRED_PROFILE_INVALID");
    }
    return Object.freeze({
      accepted_to_preview_ms: Number(item.timings.accepted_to_preview_ms),
      fixture_id: item.fixture_id,
      peak_process_tree_rss_bytes: Number(
        item.memory.peak_process_tree_rss_bytes,
      ),
      publish_to_public_ms: Number(item.timings.publish_requested_to_public_ms),
      reference_exact: exactByFixture.get(item.fixture_id) === true,
      status: "passed" as const,
      wall_ms: Number(item.timings.wall_ms),
    });
  });
  if (measurements.length !== 15) {
    throw new Error("PIPELINE_PAIRED_PROFILE_INVALID");
  }
  return Object.freeze(measurements);
}

function orderForPair(pairIndex: number): PairOrder {
  return pairIndex % 2 === 0 ? "BA" : "AB";
}

function variantsForOrder(order: PairOrder): readonly BenchmarkVariant[] {
  return order === "AB"
    ? (["baseline", "candidate"] as const)
    : (["candidate", "baseline"] as const);
}

async function runOne(input: {
  readonly fixtureManifestSha256: string;
  readonly fixtureOrder: readonly string[];
  readonly hostEnvironment: ParsedBenchmarkEnvironment;
  readonly outputDirectory: string;
  readonly pairIndex: number;
  readonly position: number;
  readonly realDirectory: string;
  readonly realManifest: string;
  readonly referenceBindingsSha256: string;
  readonly referenceDirectory: string;
  readonly worktree: PreparedWorktree;
}): Promise<BenchmarkRun> {
  const order = orderForPair(input.pairIndex);
  const recordPath = join(
    input.outputDirectory,
    `pair-${String(input.pairIndex).padStart(2, "0")}-${input.worktree.variant}.json`,
  );
  const runRoot = join(
    input.outputDirectory,
    `pair-${String(input.pairIndex).padStart(2, "0")}-${input.worktree.variant}`,
  );
  const referenceReportPath = join(runRoot, "reference.json");
  const correctnessReceiptPath = join(
    input.outputDirectory,
    "correctness",
    input.worktree.commitSha,
    `${input.fixtureManifestSha256}.${input.referenceBindingsSha256}.json`,
  );
  const existing = await readFile(recordPath, "utf8").catch(() => null);
  if (existing) {
    const parsed = parseBenchmarkRun(JSON.parse(existing) as unknown);
    if (
      parsed.commit_sha === input.worktree.commitSha &&
      parsed.fixture_manifest_sha256 === input.fixtureManifestSha256 &&
      parsed.environment_sha256 ===
        input.hostEnvironment.environment_fingerprint_sha256 &&
      parsed.fixture_order.every(
        (fixtureId, index) => fixtureId === input.fixtureOrder[index],
      ) &&
      parsed.order === order &&
      parsed.position === input.position
    ) {
      await loadOrCreateCorrectnessReceipt({
        commitSha: input.worktree.commitSha,
        createReferenceReport: async () => {
          const referenceBytes = await readFile(referenceReportPath);
          if (sha256(referenceBytes) !== parsed.reference_report_sha256) {
            throw new Error("PIPELINE_PAIRED_RESUME_REFERENCE_MISMATCH");
          }
          return JSON.parse(referenceBytes.toString("utf8")) as unknown;
        },
        fixtureManifestSha256: input.fixtureManifestSha256,
        path: correctnessReceiptPath,
        referenceBindingsSha256: input.referenceBindingsSha256,
      });
      return parsed;
    }
    throw new Error("PIPELINE_PAIRED_RESUME_BINDING_MISMATCH");
  }

  const environmentPath = join(runRoot, "environment.json");
  const profilePath = join(runRoot, "pipeline.json");
  const profileDirectory = join(runRoot, "profiles");
  const observedDirectory = join(runRoot, "observed-v2");
  await mkdir(runRoot, { mode: 0o700, recursive: true });

  await runCommand({
    arguments: ["benchmark:environment", "--output", environmentPath],
    command: "pnpm",
    cwd: input.worktree.path,
  });
  const profileResults: unknown[] = [];
  for (const [index, fixtureId] of input.fixtureOrder.entries()) {
    const partPath = join(
      runRoot,
      "profile-parts",
      `${String(index + 1).padStart(2, "0")}-${fixtureId}.json`,
    );
    await runCommand({
      arguments: [
        "benchmark:pipeline-profile",
        "--real-dir",
        input.realDirectory,
        "--real-manifest",
        input.realManifest,
        "--fixture-ids",
        fixtureId,
        "--profile-dir",
        profileDirectory,
        "--output",
        partPath,
        "--repetitions",
        "1",
      ],
      command: "pnpm",
      cwd: input.worktree.path,
    });
    const part = JSON.parse(await readFile(partPath, "utf8")) as unknown;
    if (
      !isRecord(part) ||
      part.schema_version !== 1 ||
      part.status !== "passed" ||
      !Array.isArray(part.results) ||
      part.results.length !== 1 ||
      !isRecord(part.results[0]) ||
      part.results[0].fixture_id !== fixtureId
    ) {
      throw new Error("PIPELINE_PAIRED_PROFILE_INVALID");
    }
    profileResults.push(part.results[0]);
  }
  await atomicJson(profilePath, {
    fixture_order: input.fixtureOrder,
    results: profileResults,
    schema_version: 1,
    status: "passed",
  });
  const reference = await loadOrCreateCorrectnessReceipt({
    commitSha: input.worktree.commitSha,
    createReferenceReport: async () => {
      await runCommand({
        arguments: [
          "fixtures:observe-references",
          "--real-dir",
          input.realDirectory,
          "--output",
          observedDirectory,
        ],
        command: "pnpm",
        cwd: input.worktree.path,
      });
      await runCommand({
        arguments: [
          "fixtures:compare-references",
          "--reference-dir",
          input.referenceDirectory,
          "--observed-dir",
          observedDirectory,
          "--output",
          referenceReportPath,
        ],
        command: "pnpm",
        cwd: input.worktree.path,
      });
      return JSON.parse(await readFile(referenceReportPath, "utf8")) as unknown;
    },
    fixtureManifestSha256: input.fixtureManifestSha256,
    path: correctnessReceiptPath,
    referenceBindingsSha256: input.referenceBindingsSha256,
  });
  await atomicJson(referenceReportPath, reference.value);

  const [environmentBytes, profileBytes, referenceBytes] = await Promise.all([
    readFile(environmentPath),
    readFile(profilePath),
    readFile(referenceReportPath),
  ]);
  const environment = parseBenchmarkEnvironment(
    JSON.parse(environmentBytes.toString("utf8")) as unknown,
  );
  assertBenchmarkEnvironmentCompatible(input.hostEnvironment, environment);
  const [commitSha, status] = await Promise.all([
    git(["rev-parse", "HEAD"], input.worktree.path),
    git(
      ["status", "--porcelain=v1", "--untracked-files=no"],
      input.worktree.path,
    ),
  ]);
  const dirty = status.length > 0;
  if (
    !reference.ok ||
    commitSha !== input.worktree.commitSha ||
    (environment.reported_source !== null &&
      (environment.reported_source.commit_sha !== commitSha ||
        environment.reported_source.dirty !== dirty))
  ) {
    throw new Error("PIPELINE_PAIRED_RUN_BINDING_INVALID");
  }
  const record = parseBenchmarkRun({
    commit_sha: commitSha,
    dirty,
    environment_sha256: input.hostEnvironment.environment_fingerprint_sha256,
    fixture_order: input.fixtureOrder,
    fixture_manifest_sha256: input.fixtureManifestSha256,
    lockfile_sha256: environment.lockfile_sha256,
    measurements: parseMeasurements(
      JSON.parse(profileBytes.toString("utf8")) as unknown,
      reference.exactByFixture,
    ),
    order,
    pair_index: input.pairIndex,
    position: input.position,
    reference_report_sha256: sha256(referenceBytes),
    raw_environment_report_sha256: sha256(environmentBytes),
    variant: input.worktree.variant,
  });
  await atomicJson(recordPath, record);
  return record;
}

export async function runPipelinePaired(
  input: PipelinePairedArguments,
): Promise<{
  readonly evaluation: ReturnType<typeof evaluatePairedPerformance>;
  readonly report: PairedBenchmarkReport;
}> {
  const [baselineCommit, candidateCommit, preflight] = await Promise.all([
    resolveCommit(input.baselineRef),
    resolveCommit(input.candidateRef),
    loadReferencePreflight(input),
  ]);
  if (baselineCommit === candidateCommit) {
    throw new Error("PIPELINE_PAIRED_REFS_IDENTICAL");
  }
  const outputDirectory = `${input.output}.runs`;
  const referenceBindingsSha256 = sha256(JSON.stringify(preflight.bindings));
  await mkdir(outputDirectory, { mode: 0o700, recursive: true });
  await atomicJson(
    join(outputDirectory, "reference-bindings.json"),
    preflight.bindings,
  );
  const hostEnvironmentPath = join(outputDirectory, "host-environment.json");
  await runCommand({
    arguments: ["benchmark:environment", "--output", hostEnvironmentPath],
    command: "pnpm",
    cwd: repositoryRoot,
  });
  const hostEnvironment = parseBenchmarkEnvironment(
    JSON.parse(await readFile(hostEnvironmentPath, "utf8")) as unknown,
  );
  if (hostEnvironment.environment_fingerprint_sha256 === null) {
    throw new Error("PIPELINE_PAIRED_ENVIRONMENT_INVALID");
  }

  const worktreeRoot = await mkdtemp(
    join(tmpdir(), "mirawind-paired-worktrees-"),
  );
  const worktrees: PreparedWorktree[] = [];
  let fixtureView: string | null = null;
  try {
    worktrees.push(
      await addWorktree({
        commitSha: baselineCommit,
        root: worktreeRoot,
        variant: "baseline",
      }),
    );
    worktrees.push(
      await addWorktree({
        commitSha: candidateCommit,
        root: worktreeRoot,
        variant: "candidate",
      }),
    );
    await Promise.all(worktrees.map(prepareWorktree));
    const baselineWorktree = worktrees.find(
      (worktree) => worktree.variant === "baseline",
    );
    if (!baselineWorktree) throw new Error("PIPELINE_PAIRED_WORKTREE_MISSING");
    fixtureView = await prepareReferenceFixtureView({
      fixtureFiles: preflight.fixtureFiles,
      implementationRoot: baselineWorktree.path,
      manifestName: input.realManifest,
      outputDirectory: join(outputDirectory, "fixture-view"),
      sourceDirectory: input.realDirectory,
    });

    const runs: BenchmarkRun[] = [];
    let targetPairCount: 3 | 5 = input.initialPairCount;
    for (let pairIndex = 1; pairIndex <= targetPairCount; pairIndex += 1) {
      const order = orderForPair(pairIndex);
      const variants = variantsForOrder(order);
      const fixtureOrder = fixtureOrderForPair(
        preflight.bindings,
        preflight.manifestSha256,
        pairIndex,
      );
      for (const [index, variant] of variants.entries()) {
        const worktree = worktrees.find((item) => item.variant === variant);
        if (!worktree) throw new Error("PIPELINE_PAIRED_WORKTREE_MISSING");
        runs.push(
          await runOne({
            fixtureManifestSha256: preflight.manifestSha256,
            fixtureOrder,
            hostEnvironment,
            outputDirectory,
            pairIndex,
            position: index + 1,
            realDirectory: fixtureView,
            realManifest: input.realManifest,
            referenceBindingsSha256,
            referenceDirectory: join(input.realDirectory, "references-v3"),
            worktree,
          }),
        );
      }
      if (pairIndex === 3) {
        const preliminary = evaluatePairedPerformance(runs);
        if (preliminary.requires_five_pairs) targetPairCount = 5;
      }
    }
    const order = Object.freeze(
      Array.from({ length: targetPairCount }, (_, index) =>
        orderForPair(index + 1),
      ),
    );
    const report = parsePairedBenchmarkReport({
      baseline_ref: baselineCommit,
      candidate_ref: candidateCommit,
      fixture_manifest_sha256: preflight.manifestSha256,
      order,
      runs,
      schema_version: 1,
    });
    const evaluation = evaluatePairedPerformance(report.runs);
    await atomicJson(input.output, report);
    await atomicJson(`${input.output}.evaluation.json`, evaluation);
    return Object.freeze({ evaluation, report });
  } finally {
    await Promise.all(
      worktrees.map((worktree) => removeWorktree(worktree.path)),
    );
    if (fixtureView) {
      await rm(fixtureView, { force: true, recursive: true });
    }
    await rm(worktreeRoot, { force: true, recursive: true });
  }
}

async function main(): Promise<void> {
  const input = parsePipelinePairedArguments(process.argv.slice(2));
  await access(input.realDirectory);
  const result = await runPipelinePaired(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.evaluation.passed) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "PIPELINE_PAIRED_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
