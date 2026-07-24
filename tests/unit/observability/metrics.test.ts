import { describe, expect, it } from "vitest";

import { OperationalMetrics } from "@/observability/metrics";

describe("bounded operational metrics", () => {
  it("reports timings, transitions and only safe failure labels", () => {
    const metrics = new OperationalMetrics();
    for (let value = 1; value <= 100; value += 1) {
      metrics.recordRequest("read", value);
      metrics.recordQueueAge(value * 2);
    }
    metrics.recordRequest("search", 12);
    metrics.recordPhase("build.render", 40);
    metrics.recordTransition("publication.ready");
    metrics.recordTransition("publication.ready");
    metrics.recordFailure("content", "ARCHIVE_INVALID");
    metrics.recordFailure("unsafe value", "path/secret");

    expect(metrics.snapshot()).toMatchObject({
      failures: {
        "content:ARCHIVE_INVALID": 1,
        "unknown:UNKNOWN_FAILURE": 1,
      },
      phases: { "build.render": { count: 1, p95: 40 } },
      queueAgeMs: { count: 100, p50: 100, p95: 190, p99: 198 },
      requestMs: {
        read: { count: 100, p50: 50, p95: 95, p99: 99 },
        search: { count: 1, p50: 12 },
      },
      transitions: { "publication.ready": 2 },
    });
  });

  it("bounds retained samples", () => {
    const metrics = new OperationalMetrics();
    for (let value = 0; value < 3_000; value += 1) {
      metrics.recordRequest("read", value);
    }
    expect(metrics.snapshot().requestMs.read.count).toBe(2_048);
  });
});
