import { Session } from "node:inspector/promises";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { performance, type EventLoopUtilization } from "node:perf_hooks";

export const pipelineProfileSchemaVersion = 1 as const;

export const pipelineProfileStageNames = [
  "archive_extract",
  "candidate_discovery",
  "artifact_write",
  "markdown_read",
  "typography",
  "structural_cleanup",
  "parse_normalize",
  "layout_evidence",
  "resource_resolution",
  "image_inspection",
  "initial_printed_contents",
  "pdf_evidence",
  "repaired_printed_contents",
  "source_regions",
  "structure_proposal",
  "input_validation",
  "configured_document",
  "asset_copy",
  "candidate_materialization",
  "manifest_build",
  "source_copy",
  "original_copy",
  "file_inventory",
  "version_marker",
  "candidate_finalize",
] as const;

export type PipelineProfileStageName =
  (typeof pipelineProfileStageNames)[number];

export const pipelineProfileMetricNames = [
  "archive_entries",
  "archive_files",
  "archive_reused",
  "archive_uncompressed_bytes",
  "markdown_candidates",
  "markdown_bytes",
  "root_blocks",
  "headings",
  "protected_nodes",
  "cleanup_printed_toc_regions_removed",
  "cleanup_helper_blocks_removed",
  "layout_records",
  "printed_regions",
  "printed_entries",
  "printed_alignment_cells",
  "pdf_pages",
  "resources",
  "resource_bytes",
  "pages",
  "output_bytes",
  "search_fts_rows",
  "search_short_rows",
] as const;

export type PipelineProfileMetricName =
  (typeof pipelineProfileMetricNames)[number];

interface ProcessSnapshot {
  readonly cpuSystemMicroseconds: number;
  readonly cpuUserMicroseconds: number;
  readonly eventLoop: EventLoopUtilization;
  readonly fsReadOperations: number;
  readonly fsWriteOperations: number;
  readonly heapUsedBytes: number;
  readonly readBytes: number;
  readonly rssBytes: number;
  readonly wallMs: number;
  readonly writeBytes: number;
}

export interface PipelineProfileMeasurement {
  readonly cpu_system_ms: number;
  readonly cpu_user_ms: number;
  readonly duration_ms: number;
  readonly event_loop_utilization: number;
  readonly fs_read_operations: number;
  readonly fs_write_operations: number;
  readonly peak_heap_used_bytes: number;
  readonly peak_rss_bytes: number;
  readonly proc_read_bytes: number;
  readonly proc_write_bytes: number;
}

export interface PipelineProfileStage extends PipelineProfileMeasurement {
  readonly name: PipelineProfileStageName;
  readonly status: "failed" | "passed";
}

export interface PipelineProfileArtifact extends PipelineProfileMeasurement {
  readonly job_id: string;
  readonly job_kind: string;
  readonly metrics: Readonly<
    Partial<Record<PipelineProfileMetricName, number>>
  >;
  readonly schema_version: typeof pipelineProfileSchemaVersion;
  readonly stages: readonly PipelineProfileStage[];
  readonly status: "failed" | "passed";
}

interface MutableStage {
  readonly name: PipelineProfileStageName;
  readonly snapshot: ProcessSnapshot;
  peakHeapUsedBytes: number;
  peakRssBytes: number;
}

interface ActiveProfile {
  activeStage: MutableStage | null;
  readonly cpuProfileDirectory: string | null;
  inspector: Session | null;
  readonly jobId: string;
  readonly jobKind: string;
  readonly metrics: Partial<Record<PipelineProfileMetricName, number>>;
  readonly outputDirectory: string;
  overallPeakHeapUsedBytes: number;
  overallPeakRssBytes: number;
  readonly snapshot: ProcessSnapshot;
  readonly stages: PipelineProfileStage[];
  timer: NodeJS.Timeout | null;
}

let activeProfile: ActiveProfile | null = null;

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function procIo(): { readonly readBytes: number; readonly writeBytes: number } {
  if (process.platform !== "linux") return { readBytes: 0, writeBytes: 0 };
  try {
    const value = readFileSync("/proc/self/io", "utf8");
    const read = /^read_bytes:\s+([0-9]+)$/mu.exec(value);
    const write = /^write_bytes:\s+([0-9]+)$/mu.exec(value);
    return {
      readBytes: read ? Number(read[1]) : 0,
      writeBytes: write ? Number(write[1]) : 0,
    };
  } catch {
    return { readBytes: 0, writeBytes: 0 };
  }
}

function snapshot(): ProcessSnapshot {
  const usage = process.resourceUsage();
  const memory = process.memoryUsage();
  const io = procIo();
  return {
    cpuSystemMicroseconds: usage.systemCPUTime,
    cpuUserMicroseconds: usage.userCPUTime,
    eventLoop: performance.eventLoopUtilization(),
    fsReadOperations: usage.fsRead,
    fsWriteOperations: usage.fsWrite,
    heapUsedBytes: memory.heapUsed,
    readBytes: io.readBytes,
    rssBytes: memory.rss,
    wallMs: performance.now(),
    writeBytes: io.writeBytes,
  };
}

function measurement(
  start: ProcessSnapshot,
  end: ProcessSnapshot,
  peakHeapUsedBytes: number,
  peakRssBytes: number,
): PipelineProfileMeasurement {
  return Object.freeze({
    cpu_system_ms: rounded(
      Math.max(0, end.cpuSystemMicroseconds - start.cpuSystemMicroseconds) /
        1_000,
    ),
    cpu_user_ms: rounded(
      Math.max(0, end.cpuUserMicroseconds - start.cpuUserMicroseconds) / 1_000,
    ),
    duration_ms: rounded(Math.max(0, end.wallMs - start.wallMs)),
    event_loop_utilization: rounded(
      performance.eventLoopUtilization(end.eventLoop, start.eventLoop)
        .utilization,
    ),
    fs_read_operations: Math.max(
      0,
      end.fsReadOperations - start.fsReadOperations,
    ),
    fs_write_operations: Math.max(
      0,
      end.fsWriteOperations - start.fsWriteOperations,
    ),
    peak_heap_used_bytes: Math.max(
      start.heapUsedBytes,
      end.heapUsedBytes,
      peakHeapUsedBytes,
    ),
    peak_rss_bytes: Math.max(start.rssBytes, end.rssBytes, peakRssBytes),
    proc_read_bytes: Math.max(0, end.readBytes - start.readBytes),
    proc_write_bytes: Math.max(0, end.writeBytes - start.writeBytes),
  });
}

function safeProfileDirectory(value: string | undefined): string | null {
  if (!value) return null;
  const directory = resolve(value);
  if (!isAbsolute(value) || directory === sep) {
    throw new Error("PIPELINE_PROFILE_DIRECTORY_INVALID");
  }
  return directory;
}

function sampleMemory(): void {
  const profile = activeProfile;
  if (!profile) return;
  const memory = process.memoryUsage();
  profile.overallPeakHeapUsedBytes = Math.max(
    profile.overallPeakHeapUsedBytes,
    memory.heapUsed,
  );
  profile.overallPeakRssBytes = Math.max(
    profile.overallPeakRssBytes,
    memory.rss,
  );
  if (profile.activeStage) {
    profile.activeStage.peakHeapUsedBytes = Math.max(
      profile.activeStage.peakHeapUsedBytes,
      memory.heapUsed,
    );
    profile.activeStage.peakRssBytes = Math.max(
      profile.activeStage.peakRssBytes,
      memory.rss,
    );
  }
}

export async function startPipelineProfile(input: {
  readonly jobId: string;
  readonly jobKind: string;
}): Promise<void> {
  const outputDirectory = safeProfileDirectory(
    process.env.MIRAWIND_PIPELINE_PROFILE_DIR,
  );
  if (!outputDirectory || activeProfile) return;
  if (!/^job_[A-Za-z0-9_-]{8,80}$/u.test(input.jobId)) {
    throw new Error("PIPELINE_PROFILE_JOB_ID_INVALID");
  }
  await mkdir(outputDirectory, { mode: 0o700, recursive: true });
  const first = snapshot();
  const profile: ActiveProfile = {
    activeStage: null,
    cpuProfileDirectory: safeProfileDirectory(
      process.env.MIRAWIND_PIPELINE_CPU_PROFILE_DIR,
    ),
    inspector: null,
    jobId: input.jobId,
    jobKind: input.jobKind,
    metrics: {},
    outputDirectory,
    overallPeakHeapUsedBytes: first.heapUsedBytes,
    overallPeakRssBytes: first.rssBytes,
    snapshot: first,
    stages: [],
    timer: null,
  };
  activeProfile = profile;
  profile.timer = setInterval(sampleMemory, 25);
  profile.timer.unref();
  if (profile.cpuProfileDirectory) {
    await mkdir(profile.cpuProfileDirectory, { mode: 0o700, recursive: true });
    const inspector = new Session();
    inspector.connect();
    await inspector.post("Profiler.enable");
    await inspector.post("Profiler.start");
    profile.inspector = inspector;
  }
}

export function recordPipelineProfileMetrics(
  metrics: Readonly<Partial<Record<PipelineProfileMetricName, number>>>,
): void {
  const profile = activeProfile;
  if (!profile) return;
  for (const [name, value] of Object.entries(metrics)) {
    if (
      !pipelineProfileMetricNames.includes(name as PipelineProfileMetricName) ||
      value === undefined ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error("PIPELINE_PROFILE_METRIC_INVALID");
    }
    profile.metrics[name as PipelineProfileMetricName] = value;
  }
}

export async function profilePipelineStage<Result>(
  name: PipelineProfileStageName,
  operation: () => Result | Promise<Result>,
): Promise<Result> {
  const profile = activeProfile;
  if (!profile) return await operation();
  if (profile.activeStage) {
    throw new Error("PIPELINE_PROFILE_STAGE_NESTED");
  }
  const first = snapshot();
  const stage: MutableStage = {
    name,
    peakHeapUsedBytes: first.heapUsedBytes,
    peakRssBytes: first.rssBytes,
    snapshot: first,
  };
  profile.activeStage = stage;
  let status: PipelineProfileStage["status"] = "passed";
  try {
    return await operation();
  } catch (error) {
    status = "failed";
    throw error;
  } finally {
    sampleMemory();
    const end = snapshot();
    profile.stages.push(
      Object.freeze({
        ...measurement(
          stage.snapshot,
          end,
          stage.peakHeapUsedBytes,
          stage.peakRssBytes,
        ),
        name,
        status,
      }),
    );
    profile.activeStage = null;
  }
}

async function writeAtomic(path: string, value: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, value, { mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function finishPipelineProfile(
  status: PipelineProfileArtifact["status"],
): Promise<void> {
  const profile = activeProfile;
  if (!profile) return;
  activeProfile = null;
  if (profile.timer) clearInterval(profile.timer);
  sampleMemory();
  const end = snapshot();
  if (profile.inspector && profile.cpuProfileDirectory) {
    const result = await profile.inspector.post("Profiler.stop");
    await writeAtomic(
      join(profile.cpuProfileDirectory, `${profile.jobId}.cpuprofile`),
      JSON.stringify(result.profile),
    );
    profile.inspector.disconnect();
  }
  const artifact: PipelineProfileArtifact = Object.freeze({
    ...measurement(
      profile.snapshot,
      end,
      profile.overallPeakHeapUsedBytes,
      profile.overallPeakRssBytes,
    ),
    job_id: profile.jobId,
    job_kind: profile.jobKind,
    metrics: Object.freeze({ ...profile.metrics }),
    schema_version: pipelineProfileSchemaVersion,
    stages: Object.freeze([...profile.stages]),
    status,
  });
  await writeAtomic(
    join(profile.outputDirectory, `${profile.jobId}.json`),
    `${JSON.stringify(artifact)}\n`,
  );
}

export function pipelineProfileEnabled(): boolean {
  return activeProfile !== null;
}

function profileRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label.toUpperCase()}_INVALID`);
  }
  return value as Record<string, unknown>;
}

function exactProfileKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label.toUpperCase()}_FIELDS_INVALID`);
  }
}

function profileNumber(
  value: unknown,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new Error(`${label.toUpperCase()}_INVALID`);
  }
  return value;
}

const measurementKeys = [
  "cpu_system_ms",
  "cpu_user_ms",
  "duration_ms",
  "event_loop_utilization",
  "fs_read_operations",
  "fs_write_operations",
  "peak_heap_used_bytes",
  "peak_rss_bytes",
  "proc_read_bytes",
  "proc_write_bytes",
] as const;

function parseMeasurement(
  value: Record<string, unknown>,
  label: string,
): PipelineProfileMeasurement {
  return Object.freeze({
    cpu_system_ms: profileNumber(value.cpu_system_ms, `${label}_cpu_system_ms`),
    cpu_user_ms: profileNumber(value.cpu_user_ms, `${label}_cpu_user_ms`),
    duration_ms: profileNumber(value.duration_ms, `${label}_duration_ms`),
    event_loop_utilization: profileNumber(
      value.event_loop_utilization,
      `${label}_event_loop_utilization`,
      1,
    ),
    fs_read_operations: profileNumber(
      value.fs_read_operations,
      `${label}_fs_read_operations`,
    ),
    fs_write_operations: profileNumber(
      value.fs_write_operations,
      `${label}_fs_write_operations`,
    ),
    peak_heap_used_bytes: profileNumber(
      value.peak_heap_used_bytes,
      `${label}_peak_heap_used_bytes`,
    ),
    peak_rss_bytes: profileNumber(
      value.peak_rss_bytes,
      `${label}_peak_rss_bytes`,
    ),
    proc_read_bytes: profileNumber(
      value.proc_read_bytes,
      `${label}_proc_read_bytes`,
    ),
    proc_write_bytes: profileNumber(
      value.proc_write_bytes,
      `${label}_proc_write_bytes`,
    ),
  });
}

/** Strictly parses benchmark-only child output before it enters a saved report. */
export function parsePipelineProfileArtifact(
  value: unknown,
): PipelineProfileArtifact {
  const input = profileRecord(value, "pipeline_profile");
  exactProfileKeys(
    input,
    [
      ...measurementKeys,
      "job_id",
      "job_kind",
      "metrics",
      "schema_version",
      "stages",
      "status",
    ],
    "pipeline_profile",
  );
  if (
    input.schema_version !== pipelineProfileSchemaVersion ||
    typeof input.job_id !== "string" ||
    !/^job_[A-Za-z0-9_-]{8,80}$/u.test(input.job_id) ||
    typeof input.job_kind !== "string" ||
    !/^[a-z][a-z0-9_]{2,40}$/u.test(input.job_kind) ||
    (input.status !== "passed" && input.status !== "failed") ||
    !Array.isArray(input.stages) ||
    input.stages.length > 100
  ) {
    throw new Error("PIPELINE_PROFILE_INVALID");
  }
  const metricsInput = profileRecord(input.metrics, "pipeline_profile_metrics");
  const metrics: Partial<Record<PipelineProfileMetricName, number>> = {};
  for (const [name, metric] of Object.entries(metricsInput)) {
    if (
      !pipelineProfileMetricNames.includes(name as PipelineProfileMetricName)
    ) {
      throw new Error("PIPELINE_PROFILE_METRIC_UNKNOWN");
    }
    const parsed = profileNumber(metric, `pipeline_profile_metric_${name}`);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error("PIPELINE_PROFILE_METRIC_INVALID");
    }
    metrics[name as PipelineProfileMetricName] = parsed;
  }
  const stages = input.stages.map((stageValue, index) => {
    const stage = profileRecord(stageValue, `pipeline_profile_stage_${index}`);
    exactProfileKeys(
      stage,
      [...measurementKeys, "name", "status"],
      `pipeline_profile_stage_${index}`,
    );
    if (
      !pipelineProfileStageNames.includes(
        stage.name as PipelineProfileStageName,
      ) ||
      (stage.status !== "passed" && stage.status !== "failed")
    ) {
      throw new Error("PIPELINE_PROFILE_STAGE_INVALID");
    }
    return Object.freeze({
      ...parseMeasurement(stage, `pipeline_profile_stage_${index}`),
      name: stage.name as PipelineProfileStageName,
      status: stage.status,
    });
  });
  return Object.freeze({
    ...parseMeasurement(input, "pipeline_profile"),
    job_id: input.job_id,
    job_kind: input.job_kind,
    metrics: Object.freeze(metrics),
    schema_version: pipelineProfileSchemaVersion,
    stages: Object.freeze(stages),
    status: input.status,
  });
}
