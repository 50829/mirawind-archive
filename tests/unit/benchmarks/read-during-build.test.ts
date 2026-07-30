import { describe, expect, it } from "vitest";

import { buildReadDuringBuildReport } from "../../../scripts/benchmarks/read-during-build.js";

function samples(value: number): readonly number[] {
  return Object.freeze(Array.from({ length: 200 }, () => value));
}

describe("read-during-build report", () => {
  it("reports and enforces page, resource and search independently", () => {
    const report = buildReadDuringBuildReport({
      normalQuery: "chapter",
      page: samples(250),
      pageObservedBuildRequests: 200,
      resource: samples(301),
      resourceObservedBuildRequests: 200,
      search: samples(999),
      searchObservedBuildRequests: 200,
    });

    expect(report.page.status).toBe("passed");
    expect(report.resource.status).toBe("failed");
    expect(report.search.status).toBe("passed");
    expect(report.status).toBe("failed");
  });

  it("fails a branch when any measured request misses the candidate overlap", () => {
    const report = buildReadDuringBuildReport({
      normalQuery: "chapter",
      page: samples(10),
      pageObservedBuildRequests: 199,
      resource: samples(10),
      resourceObservedBuildRequests: 200,
      search: samples(10),
      searchObservedBuildRequests: 200,
    });

    expect(report.page).toMatchObject({
      observed_build_requests: 199,
      status: "failed",
    });
    expect(report.resource.status).toBe("passed");
    expect(report.search.status).toBe("passed");
  });
});
