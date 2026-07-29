import { describe, expect, it } from "vitest";

import { parseBuildArguments } from "../../../scripts/benchmarks/build.js";
import { parsePipelineProfileArguments } from "../../../scripts/benchmarks/pipeline-profile.js";

describe("pipeline profile benchmark arguments", () => {
  it("selects opaque fixtures, repetitions and no stress by default", () => {
    const parsed = parsePipelineProfileArguments([
      "--real-dir",
      "/tmp/real-fixtures",
      "--profile-dir",
      "/tmp/profiles",
      "--output",
      "/tmp/results.json",
      "--fixture-ids",
      "real-mineru-abcdef123456,real-mineru-fedcba654321",
      "--repetitions",
      "3",
    ]);
    expect(parsed).toMatchObject({
      fixtureIds: ["real-mineru-abcdef123456", "real-mineru-fedcba654321"],
      includeStress: false,
      repetitions: 3,
    });
  });

  it("keeps the established build benchmark defaults", () => {
    const parsed = parseBuildArguments([]);
    expect(parsed.includeStress).toBe(true);
    expect(parsed.repetitions).toBe(1);
  });

  it("rejects duplicate fixture IDs and missing output roots", () => {
    expect(() =>
      parseBuildArguments([
        "--fixture-ids",
        "real-mineru-abcdef123456,real-mineru-abcdef123456",
      ]),
    ).toThrow("fixture IDs");
    expect(() =>
      parsePipelineProfileArguments([
        "--real-dir",
        "/tmp/real-fixtures",
        "--profile-dir",
        "/tmp/profiles",
      ]),
    ).toThrow("PIPELINE_PROFILE_OUTPUT_REQUIRED");
  });
});
