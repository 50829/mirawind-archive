import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  finishPipelineProfile,
  parsePipelineProfileArtifact,
  profilePipelineStage,
  recordPipelineProfileMetrics,
  startPipelineProfile,
} from "../../../src/observability/pipeline-profile.js";

const directories: string[] = [];
const originalProfileDirectory = process.env.MIRAWIND_PIPELINE_PROFILE_DIR;
const originalCpuProfileDirectory =
  process.env.MIRAWIND_PIPELINE_CPU_PROFILE_DIR;

afterEach(async () => {
  await finishPipelineProfile("failed");
  if (originalProfileDirectory === undefined) {
    delete process.env.MIRAWIND_PIPELINE_PROFILE_DIR;
  } else {
    process.env.MIRAWIND_PIPELINE_PROFILE_DIR = originalProfileDirectory;
  }
  if (originalCpuProfileDirectory === undefined) {
    delete process.env.MIRAWIND_PIPELINE_CPU_PROFILE_DIR;
  } else {
    process.env.MIRAWIND_PIPELINE_CPU_PROFILE_DIR = originalCpuProfileDirectory;
  }
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("pipeline profile", () => {
  it("writes and strictly parses bounded numeric child evidence", async () => {
    const directory = join(
      tmpdir(),
      `mirawind-pipeline-profile-${process.pid}-${Date.now()}`,
    );
    directories.push(directory);
    process.env.MIRAWIND_PIPELINE_PROFILE_DIR = directory;
    delete process.env.MIRAWIND_PIPELINE_CPU_PROFILE_DIR;
    const jobId = "job_profile_test_12345678";

    await startPipelineProfile({ jobId, jobKind: "prepare_draft" });
    await profilePipelineStage("candidate_discovery", () => undefined);
    recordPipelineProfileMetrics({
      archive_files: 12,
      archive_uncompressed_bytes: 4_096,
      content_candidates: 1,
    });
    await finishPipelineProfile("passed");

    const raw = await readFile(join(directory, `${jobId}.json`), "utf8");
    const profile = parsePipelineProfileArtifact(JSON.parse(raw) as unknown);
    expect(profile).toMatchObject({
      job_id: jobId,
      job_kind: "prepare_draft",
      metrics: {
        archive_files: 12,
        archive_uncompressed_bytes: 4_096,
        content_candidates: 1,
      },
      schema_version: 2,
      status: "passed",
    });
    expect(profile.stages).toMatchObject([
      {
        name: "candidate_discovery",
        status: "passed",
        duration_ms: expect.any(Number),
      },
    ]);
    expect(() =>
      parsePipelineProfileArtifact({ ...profile, schema_version: 1 }),
    ).toThrow("PIPELINE_PROFILE_INVALID");
    expect(() =>
      parsePipelineProfileArtifact({
        ...profile,
        stages: [{ ...profile.stages[0], name: "unknown" }],
      }),
    ).toThrow("PIPELINE_PROFILE_STAGE_INVALID");
  });

  it("rejects unknown fields", () => {
    expect(() =>
      parsePipelineProfileArtifact({ schema_version: 2, secret: "content" }),
    ).toThrow("PIPELINE_PROFILE_FIELDS_INVALID");
  });
});
