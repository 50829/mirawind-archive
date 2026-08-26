import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  TaskMonitor,
  type TaskView,
} from "@/web/components/import/TaskMonitor";

function task(
  index: number,
  state: TaskView["state"],
  kind = state === "running" ? "build_candidate" : "verify_version",
): TaskView {
  return Object.freeze({
    attempt: 1,
    automatic_retry_count: 0,
    cancellation_requested_at: null,
    created_at: new Date(Date.UTC(2026, 7, 24, 2, index)).toISOString(),
    error_class: state === "failed" ? "content" : null,
    error_code: state === "failed" ? "TEST_FAILURE" : null,
    finished_at: state === "running" ? null : new Date().toISOString(),
    job_id: `job_${String(index).padStart(24, "0")}`,
    kind,
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
      task(19, "failed", "build_candidate"),
      ...Array.from({ length: 12 }, (_value, index) =>
        task(18 - index, "succeeded", "build_candidate"),
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

  it("keeps all internal maintenance out of the user task list", () => {
    const html = renderToStaticMarkup(
      <TaskMonitor
        initialJobs={[
          task(3, "succeeded", "verify_version"),
          task(2, "succeeded", "reclaim"),
          task(1, "failed", "reconcile"),
        ]}
      />,
    );

    expect(html).not.toContain("检查已发布内容");
    expect(html).not.toContain("清理过期文件");
    expect(html).not.toContain("检查存储状态");
    expect(html).not.toContain("显式重试");
    expect(html).toContain("暂时没有后台任务");
  });
});
