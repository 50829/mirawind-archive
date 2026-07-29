import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type Database from "better-sqlite3";

import { applyMigrations } from "../../src/db/migrate.js";
import { loadMigrationManifest } from "../../src/db/migration-manifest.js";
import { openDatabase } from "../../src/db/connection.js";
import { DraftRepository } from "../../src/db/repositories/drafts.js";
import { ImportRepository } from "../../src/db/repositories/imports.js";
import {
  JobRepository,
  type JobRecord,
} from "../../src/db/repositories/jobs.js";
import {
  m1ImportExpiryMs,
  ImportUploadService,
} from "../../src/services/import-upload.js";
import { createStorageLayout } from "../../src/storage/layout.js";
import {
  verifyRealMineruFixtures,
  type VerifiedRealFixture,
} from "../fixtures/verify-real-mineru.js";
import {
  buildStressBook,
  type StressBookOptions,
} from "../fixtures/build-stress-book.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const workerEntry = join(repositoryRoot, "dist/processes/worker/index.js");
const pollIntervalMs = 100;
const perFixtureTimeoutMs = 30 * 60 * 1_000;

interface BenchmarkFixture {
  readonly id: string;
  readonly mineruVersion: "3.4.4" | "synthetic";
  readonly pageCountRange: {
    readonly maximum: number;
    readonly minimum: number;
  };
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly type: "real" | "synthetic";
}

export interface BuildArguments {
  readonly output: string | null;
  readonly realDirectory: string | null;
  readonly realManifest: string | null;
  readonly retainDirectory: string | null;
  readonly stress: StressBookOptions;
}

interface ManagedWorker {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly stop: () => Promise<void>;
  readonly waitUntilReady: () => Promise<void>;
}

interface MemoryObservation {
  readonly peakProcessTreeRssBytes: number;
  readonly samples: number;
}

function integerArgument(
  value: string | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
}

function parseArguments(arguments_: readonly string[]): BuildArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new Error("Benchmark arguments must be --name value pairs");
    }
    if (values.has(name)) throw new Error(`Duplicate argument: ${name}`);
    values.set(name, value);
  }
  for (const name of values.keys()) {
    if (
      ![
        "--output",
        "--real-dir",
        "--real-manifest",
        "--retain-dir",
        "--stress-blocks",
        "--stress-images",
        "--stress-pages",
      ].includes(name)
    ) {
      throw new Error(`Unknown argument: ${name}`);
    }
  }
  return Object.freeze({
    output: values.get("--output")
      ? resolve(String(values.get("--output")))
      : null,
    realDirectory: values.get("--real-dir")
      ? resolve(String(values.get("--real-dir")))
      : null,
    realManifest: values.get("--real-manifest") ?? null,
    retainDirectory: values.get("--retain-dir")
      ? resolve(String(values.get("--retain-dir")))
      : null,
    stress: Object.freeze({
      blocksPerPage: integerArgument(
        values.get("--stress-blocks"),
        20,
        "stress blocks",
        1,
        100,
      ),
      imageCount: integerArgument(
        values.get("--stress-images"),
        32,
        "stress images",
        0,
        500,
      ),
      pages: integerArgument(
        values.get("--stress-pages"),
        500,
        "stress pages",
        1,
        2_000,
      ),
    }),
  });
}

function safeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const match = /\b[A-Z][A-Z0-9_]{2,79}\b/u.exec(message);
  return match?.[0] ?? "BENCHMARK_FIXTURE_FAILED";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function removeBenchmarkTree(path: string): Promise<void> {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata) return;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("BENCHMARK_DATA_ROOT_INVALID");
  }
  const unlock = async (directory: string): Promise<void> => {
    await chmod(directory, 0o700);
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => unlock(join(directory, entry.name))),
    );
  };
  await unlock(path);
  await rm(path, { force: true, recursive: true });
}

async function waitFor<T>(
  inspect: () => T | null,
  deadlineMs: number,
  label: string,
): Promise<T> {
  while (Date.now() < deadlineMs) {
    const result = inspect();
    if (result !== null) return result;
    await delay(pollIntervalMs);
  }
  throw new Error(
    `${label.toUpperCase().replaceAll(/[^A-Z0-9]+/gu, "_")}_TIMEOUT`,
  );
}

function terminalFailure(job: JobRecord): Error {
  return new Error(job.errorCode ?? "BENCHMARK_JOB_FAILED");
}

async function waitForJob(
  jobs: JobRepository,
  jobId: string,
  deadlineMs: number,
): Promise<JobRecord> {
  return waitFor(
    () => {
      const job = jobs.get(jobId);
      if (!job) throw new Error("BENCHMARK_JOB_MISSING");
      if (
        job.state === "failed" ||
        job.state === "canceled" ||
        job.state === "interrupted"
      ) {
        throw terminalFailure(job);
      }
      return job.state === "succeeded" ? job : null;
    },
    deadlineMs,
    `job ${jobId}`,
  );
}

function startWorker(dataRoot: string): ManagedWorker {
  const child = spawn(process.execPath, [workerEntry], {
    cwd: repositoryRoot,
    detached: true,
    env: {
      ...process.env,
      MIRAWIND_ALLOWED_HOSTS: "benchmark.invalid",
      MIRAWIND_AUTH_SECRET: "benchmark-only-secret-0123456789-abcdef",
      MIRAWIND_DATA_DIR: dataRoot,
      MIRAWIND_PASSKEY_RP_ID: "benchmark.invalid",
      MIRAWIND_PUBLIC_ORIGIN: "https://benchmark.invalid",
      NODE_ENV: "production",
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let exited = false;
  const maximumOutput = 64 * 1024;
  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-maximumOutput);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const exitPromise = new Promise<void>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", () => {
      exited = true;
      resolveExit();
    });
  });

  return Object.freeze({
    child,
    output: () => output,
    async stop() {
      if (exited) return;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
      const graceful = await Promise.race([
        exitPromise.then(() => true),
        delay(10_000).then(() => false),
      ]);
      if (!graceful && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        await exitPromise;
      }
    },
    async waitUntilReady() {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (output.includes("Mirawind worker ready")) return;
        if (exited) throw new Error("BENCHMARK_WORKER_EXITED");
        await delay(25);
      }
      throw new Error("BENCHMARK_WORKER_READY_TIMEOUT");
    },
  });
}

async function processChildren(pid: number): Promise<readonly number[]> {
  try {
    const value = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
    return value
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isSafeInteger);
  } catch {
    return [];
  }
}

async function processTree(pid: number): Promise<readonly number[]> {
  const pending = [pid];
  const found = new Set<number>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || found.has(current)) continue;
    found.add(current);
    pending.push(...(await processChildren(current)));
  }
  return [...found];
}

async function rssBytes(pid: number): Promise<number> {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const match = /^VmRSS:\s+([0-9]+)\s+kB$/mu.exec(status);
    return match ? Number(match[1]) * 1024 : 0;
  } catch {
    return 0;
  }
}

async function monitorMemory(
  rootPid: number,
  signal: AbortSignal,
): Promise<MemoryObservation> {
  let peakProcessTreeRssBytes = 0;
  let samples = 0;
  while (!signal.aborted) {
    const pids = await processTree(rootPid);
    const values = await Promise.all(pids.map(rssBytes));
    peakProcessTreeRssBytes = Math.max(
      peakProcessTreeRssBytes,
      values.reduce((total, value) => total + value, 0),
    );
    samples += 1;
    await delay(25);
  }
  return Object.freeze({ peakProcessTreeRssBytes, samples });
}

function idempotencyKey(prefix: string, fixture: BenchmarkFixture): string {
  return `${prefix}-${fixture.sha256}`;
}

function jobDuration(job: JobRecord): number | null {
  return job.startedAtMs !== null && job.finishedAtMs !== null
    ? job.finishedAtMs - job.startedAtMs
    : null;
}

function jobRows(
  database: Database.Database,
  importId: string,
  bookId: number,
): readonly JobRecord[] {
  return new JobRepository(database)
    .listRecent(100)
    .filter((job) => job.importId === importId || job.bookId === bookId)
    .sort((left, right) => left.createdAtMs - right.createdAtMs);
}

function indexStorageBytes(database: Database.Database): number | null {
  try {
    const result = database
      .prepare(
        `SELECT COALESCE(SUM(pgsize), 0) AS bytes
         FROM dbstat
         WHERE name LIKE 'search_fts%'
            OR name LIKE 'search_short%'`,
      )
      .get() as { bytes: number };
    return result.bytes;
  } catch {
    return null;
  }
}

async function benchmarkFixture(
  fixture: BenchmarkFixture,
  retainedDataRoot?: string,
): Promise<Readonly<Record<string, unknown>>> {
  if (process.platform !== "linux") {
    throw new Error("BENCHMARK_REQUIRES_LINUX_PROCFS");
  }
  const dataRoot =
    retainedDataRoot ??
    (await mkdtemp(join(tmpdir(), "mirawind-build-benchmark-")));
  if (retainedDataRoot) {
    await removeBenchmarkTree(dataRoot);
    await mkdir(dataRoot, { mode: 0o700, recursive: true });
  }
  const startedAt = performance.now();
  let worker: ManagedWorker | null = null;
  let memoryController: AbortController | null = null;
  let memoryPromise: Promise<MemoryObservation> | null = null;
  const layout = await createStorageLayout(dataRoot);
  const databasePath = join(layout.databaseDirectory, "mirawind.sqlite");
  const database = openDatabase(databasePath, { role: "worker" });
  try {
    applyMigrations(database, await loadMigrationManifest());
    const uploadStartedAt = performance.now();
    const upload = await new ImportUploadService(database, layout).store({
      bytes: createReadStream(fixture.path),
      expiresAtMs: m1ImportExpiryMs,
      idempotencyKey: idempotencyKey("benchmark-upload", fixture),
    });
    const uploadMs =
      Math.round((performance.now() - uploadStartedAt) * 1_000) / 1_000;

    worker = startWorker(dataRoot);
    if (!worker.child.pid) throw new Error("BENCHMARK_WORKER_PID_MISSING");
    memoryController = new AbortController();
    memoryPromise = monitorMemory(worker.child.pid, memoryController.signal);
    await worker.waitUntilReady();

    const deadline = Date.now() + perFixtureTimeoutMs;
    const jobs = new JobRepository(database);
    const imports = new ImportRepository(database);
    await waitForJob(jobs, upload.job.id, deadline);
    let imported = imports.require(upload.import.id);
    if (imported.state === "needs_main_confirmation") {
      const candidates = imports.candidates(imported.id);
      if (candidates.length !== 1 || !candidates[0]) {
        throw new Error("BENCHMARK_MAIN_CANDIDATE_AMBIGUOUS");
      }
      imported = imports.confirmCandidate({
        candidateId: candidates[0].id,
        importId: imported.id,
        nowMs: Date.now(),
      });
      jobs.create({
        ...(imported.bookId === null ? {} : { bookId: imported.bookId }),
        idempotency: {
          key: idempotencyKey("benchmark-prepare", fixture),
          operation: "benchmark.prepare",
        },
        importId: imported.id,
        kind: "prepare_draft",
        nowMs: Date.now(),
      });
    }

    imported = await waitFor(
      () => {
        const current = imports.require(upload.import.id);
        const latest = jobs.latestForImport(current.id);
        if (
          latest &&
          ["failed", "canceled", "interrupted"].includes(latest.state)
        ) {
          throw terminalFailure(latest);
        }
        if (current.state === "rejected") {
          throw new Error(current.safeErrorCode ?? "BENCHMARK_IMPORT_REJECTED");
        }
        return current.state === "draft_ready" ? current : null;
      },
      deadline,
      `fixture ${fixture.id} draft`,
    );
    if (imported.bookId === null) throw new Error("BENCHMARK_BOOK_ID_MISSING");

    const drafts = new DraftRepository(database);
    const book = await waitFor(
      () => {
        const current = drafts.requireBook(imported.bookId as number);
        if (
          current.draftConfigRevision !== null &&
          current.readyPreviewRevision === current.draftConfigRevision &&
          drafts.findPreview(current.id, current.draftConfigRevision)?.state ===
            "ready"
        ) {
          return current;
        }
        const latest = jobs.latestForImport(imported.id);
        if (
          latest &&
          ["failed", "canceled", "interrupted"].includes(latest.state)
        ) {
          throw terminalFailure(latest);
        }
        return null;
      },
      deadline,
      `fixture ${fixture.id} preview`,
    );
    if (!book.draftConfigRevision || !book.draftSourceId) {
      throw new Error("BENCHMARK_DRAFT_CAPTURE_MISSING");
    }

    const publish = jobs.create({
      bookId: book.id,
      capturedConfigRevision: book.draftConfigRevision,
      ...(book.currentVersionId
        ? { capturedCurrentVersionId: book.currentVersionId }
        : {}),
      capturedSourceId: book.draftSourceId,
      idempotency: {
        key: idempotencyKey("benchmark-publish", fixture),
        operation: "benchmark.publish",
      },
      kind: "build_publish",
      nowMs: Date.now(),
    });
    await waitForJob(jobs, publish.id, deadline);
    const current = drafts.requireBook(book.id);
    if (!current.currentVersionId || current.visibility !== "public") {
      throw new Error("BENCHMARK_PUBLICATION_MISSING");
    }
    const version = database
      .prepare(
        `SELECT version_rel_path FROM book_versions
         WHERE id = ? AND state = 'published'`,
      )
      .get(current.currentVersionId) as
      { version_rel_path: string } | undefined;
    if (!version) throw new Error("BENCHMARK_VERSION_ROW_MISSING");
    const manifest = JSON.parse(
      await readFile(
        join(layout.root, version.version_rel_path, "document-manifest.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const databaseSize = (await stat(databasePath)).size;
    const walSize = await stat(`${databasePath}-wal`)
      .then((value) => value.size)
      .catch(() => 0);
    const jobsForFixture = jobRows(database, imported.id, book.id);

    memoryController.abort();
    const memory = await memoryPromise;
    memoryPromise = null;
    const analyze = jobsForFixture.find((job) => job.kind === "analyze_import");
    const phases = Object.fromEntries(
      jobsForFixture.map((job) => [
        `${job.kind}:${job.attempt}`,
        {
          duration_ms: jobDuration(job),
          state: job.state,
        },
      ]),
    );
    const wallMs = Math.round((performance.now() - startedAt) * 1_000) / 1_000;

    return Object.freeze({
      archive: {
        compressed_bytes: fixture.sizeBytes,
        entries:
          analyze?.progress.unit === "items"
            ? analyze.progress.completed
            : null,
        extracted_bytes: analyze?.progress.processed_bytes ?? null,
        files: null,
        sha256: fixture.sha256,
      },
      compiler_output: {
        blocks: Object.keys(
          (manifest.blocks as Record<string, unknown> | undefined) ?? {},
        ).length,
        bytes: null,
        files: null,
        pages: Array.isArray(manifest.pages) ? manifest.pages.length : null,
        resources: Object.keys(
          (manifest.resources as Record<string, unknown> | undefined) ?? {},
        ).length,
      },
      database: {
        file_bytes: databaseSize,
        index_storage_bytes: indexStorageBytes(database),
        wal_bytes: walSize,
      },
      fixture_id: fixture.id,
      fixture_type: fixture.type,
      fts: {
        build_ms: null,
        rows: null,
        short_rows: null,
        spool_bytes: null,
      },
      memory: {
        peak_process_tree_rss_bytes: memory.peakProcessTreeRssBytes,
        sample_interval_ms: 25,
        samples: memory.samples,
      },
      mineru_version: fixture.mineruVersion,
      page_count_range: fixture.pageCountRange,
      phases,
      status: "passed",
      timings: {
        upload_ms: uploadMs,
        wall_ms: wallMs,
      },
      version_id: current.currentVersionId,
    });
  } catch (error) {
    const failedJob = new JobRepository(database)
      .listRecent(100)
      .find((job) => ["failed", "canceled", "interrupted"].includes(job.state));
    return Object.freeze({
      error_class: failedJob?.errorClass ?? null,
      error_code: failedJob?.errorCode ?? safeFailureCode(error),
      failed_job_kind: failedJob?.kind ?? null,
      failed_job_phase: failedJob?.phase ?? null,
      fixture_id: fixture.id,
      fixture_type: fixture.type,
      mineru_version: fixture.mineruVersion,
      status: "failed",
    });
  } finally {
    memoryController?.abort();
    if (memoryPromise) await memoryPromise.catch(() => undefined);
    await worker?.stop();
    database.close();
    if (!retainedDataRoot) await removeBenchmarkTree(dataRoot);
  }
}

function realFixture(
  directory: string,
  fixture: VerifiedRealFixture,
): BenchmarkFixture {
  return Object.freeze({
    id: fixture.id,
    mineruVersion: fixture.mineruVersion as "3.4.4",
    pageCountRange: fixture.pageCountRange,
    path: join(directory, fixture.fileName),
    sha256: fixture.sha256,
    sizeBytes: fixture.sizeBytes,
    type: "real",
  });
}

async function fixtures(
  input: BuildArguments,
  temporaryDirectory: string,
): Promise<readonly BenchmarkFixture[]> {
  const result: BenchmarkFixture[] = [];
  if (input.realDirectory) {
    const verified = await verifyRealMineruFixtures(
      input.realDirectory,
      input.realManifest ?? undefined,
    );
    result.push(
      ...verified.map((fixture) =>
        realFixture(input.realDirectory as string, fixture),
      ),
    );
  }
  const stress = buildStressBook(input.stress);
  const stressPath = join(temporaryDirectory, "synthetic-stress.zip");
  await writeFile(stressPath, stress.bytes, { mode: 0o600 });
  result.push(
    Object.freeze({
      id: "synthetic-stress-v1",
      mineruVersion: "synthetic",
      pageCountRange: {
        maximum: stress.metadata.pages,
        minimum: stress.metadata.pages,
      },
      path: stressPath,
      sha256: stress.metadata.sha256,
      sizeBytes: stress.metadata.size_bytes,
      type: "synthetic",
    }),
  );
  return Object.freeze(result);
}

export async function runBuildBenchmarks(
  input: BuildArguments,
): Promise<Readonly<Record<string, unknown>>> {
  await access(workerEntry);
  if (input.retainDirectory) {
    await mkdir(input.retainDirectory, { mode: 0o700, recursive: true });
  }
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "mirawind-benchmark-fixtures-"),
  );
  try {
    const selected = await fixtures(input, temporaryDirectory);
    const results: Readonly<Record<string, unknown>>[] = [];
    let failed = false;
    for (const fixture of selected) {
      try {
        const retainedDataRoot = input.retainDirectory
          ? join(input.retainDirectory, fixture.id)
          : undefined;
        const result = await benchmarkFixture(fixture, retainedDataRoot);
        if (result.status !== "passed") failed = true;
        results.push(result);
      } catch (error) {
        failed = true;
        results.push(
          Object.freeze({
            error_code: safeFailureCode(error),
            fixture_id: fixture.id,
            fixture_type: fixture.type,
            mineru_version: fixture.mineruVersion,
            status: "failed",
          }),
        );
      }
    }
    return Object.freeze({
      captured_at: new Date().toISOString(),
      real_fixture_gate: input.realDirectory
        ? "required_and_verified"
        : "skipped",
      retained_data: input.retainDirectory !== null,
      results,
      schema_version: 1,
      status: failed ? "failed" : "passed",
      stress_configuration: {
        blocks_per_page: input.stress.blocksPerPage,
        image_count: input.stress.imageCount,
        pages: input.stress.pages,
      },
    });
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function main(): Promise<void> {
  const input = parseArguments(process.argv.slice(2));
  const report = await runBuildBenchmarks(input);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (input.output) {
    await mkdir(dirname(input.output), { mode: 0o700, recursive: true });
    await writeFile(input.output, json, { mode: 0o600 });
  }
  process.stdout.write(json);
  if (report.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeFailureCode(error)}\n`);
    process.exitCode = 1;
  });
}
