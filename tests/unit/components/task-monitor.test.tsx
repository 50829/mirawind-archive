import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  TaskMonitor,
  type TaskView,
} from "@/web/components/import/TaskMonitor";

function task(index: number, state: TaskView["state"]): TaskView {
  return Object.freeze({
    attempt: 1,
    automatic_retry_count: 0,
    cancellation_requested_at: null,
    created_at: new Date(Date.UTC(2026, 7, 24, 2, index)).toISOString(),
    error_class: state === "failed" ? "content" : null,
    error_code: state === "failed" ? "TEST_FAILURE" : null,
    finished_at: state === "running" ? null : new Date().toISOString(),
    job_id: `job_${String(index).padStart(24, "0")}`,
    kind: state === "running" ? "build_candidate" : "verify_version",
    phase: state === "running" ? "render_pages" : "complete",
    progress: Object.freeze({
      completed: state === "running" ? 2 : 1,
      processed_bytes: null,
      total: state === "running" ? 4 : 1,
      unit: state === "running" ? "pages" : "steps",
    }),
    retry_of_job_id: null,
    started_at: new Date().toISOString(),
    state,
    subject: Object.freeze({
      kind: "book" as const,
      label: `Book ${index}`,
    }),
  });
}

describe("task monitor history", () => {
  it("keeps active and actionable work visible while bounding completed history", () => {
    const jobs = [
      task(20, "running"),
      task(19, "failed"),
      ...Array.from({ length: 12 }, (_value, index) =>
        task(18 - index, "succeeded"),
      ),
    ];
    const html = renderToStaticMarkup(<TaskMonitor initialJobs={jobs} />);

    expect(html).toContain(">活动任务<");
    expect(html).toContain(">需要处理<");
    expect(html).toContain(">最近完成<");
    expect(html).toContain("显式重试");
    expect(html.match(/class="task-card /gu)).toHaveLength(10);
    expect(html).toContain("显示其余 4 个已完成任务");
  });
});
