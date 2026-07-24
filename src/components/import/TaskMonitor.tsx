import { useEffect, useMemo, useState } from "react";

type JobState =
  "canceled" | "failed" | "interrupted" | "queued" | "running" | "succeeded";

export interface TaskView {
  readonly attempt: number;
  readonly automatic_retry_count: number;
  readonly created_at: string;
  readonly error_class: string | null;
  readonly error_code: string | null;
  readonly finished_at: string | null;
  readonly job_id: string;
  readonly kind: string;
  readonly phase: string;
  readonly progress: Readonly<Record<string, boolean | number | string | null>>;
  readonly retry_of_job_id: string | null;
  readonly started_at: string | null;
  readonly state: JobState;
}

const terminalStates = new Set<JobState>([
  "canceled",
  "failed",
  "interrupted",
  "succeeded",
]);

const stateLabels: Readonly<Record<JobState, string>> = {
  canceled: "已取消",
  failed: "失败",
  interrupted: "已中断",
  queued: "排队中",
  running: "运行中",
  succeeded: "已完成",
};

function newestFirst(jobs: readonly TaskView[]): readonly TaskView[] {
  return [...jobs].sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  );
}

export function TaskMonitor(props: {
  readonly initialJobs: readonly TaskView[];
}) {
  const [jobs, setJobs] = useState(() => newestFirst(props.initialJobs));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const activeIds = useMemo(
    () =>
      jobs
        .filter((job) => !terminalStates.has(job.state))
        .map((job) => job.job_id),
    [jobs],
  );
  const activeKey = activeIds.join("|");

  async function refreshOne(jobId: string): Promise<void> {
    const response = await fetch(`/api/manage/jobs/${jobId}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("JOB_STATUS_FAILED");
    const next = (await response.json()) as TaskView;
    setJobs((current) =>
      newestFirst(
        current.map((job) => (job.job_id === next.job_id ? next : job)),
      ),
    );
  }

  useEffect(() => {
    if (!activeKey) return;
    const polledIds = activeKey.split("|");
    const timer = window.setInterval(() => {
      void Promise.all(polledIds.map(refreshOne)).catch(() =>
        setMessage("任务状态刷新失败，请稍后重试。"),
      );
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [activeKey]);

  async function mutate(job: TaskView, action: "cancel" | "retry") {
    setBusyId(job.job_id);
    setMessage("");
    const response = await fetch(`/api/manage/jobs/${job.job_id}/${action}`, {
      cache: "no-store",
      credentials: "same-origin",
      ...(action === "retry"
        ? { headers: { "Idempotency-Key": crypto.randomUUID() } }
        : {}),
      method: "POST",
    });
    const body = (await response.json()) as
      TaskView | { readonly code?: string; readonly job_id?: string };
    if (!response.ok) {
      setMessage(
        `操作失败：${"code" in body ? (body.code ?? response.status) : response.status}`,
      );
    } else if (action === "cancel") {
      const canceled = body as TaskView;
      setJobs((current) =>
        current.map((item) =>
          item.job_id === canceled.job_id ? canceled : item,
        ),
      );
      setMessage("取消请求已记录；运行中的子进程关闭后才会进入最终状态。");
    } else if ("job_id" in body && body.job_id) {
      const statusResponse = await fetch(`/api/manage/jobs/${body.job_id}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (statusResponse.ok) {
        const retry = (await statusResponse.json()) as TaskView;
        setJobs((current) => newestFirst([retry, ...current]));
      }
      setMessage("新的重试尝试已进入队列；原尝试记录保持不变。");
    }
    setBusyId(null);
  }

  return (
    <section className="task-monitor" aria-labelledby="task-monitor-title">
      <header>
        <div>
          <p className="eyebrow">后台工作</p>
          <h1 id="task-monitor-title">任务与恢复</h1>
        </div>
        <p className="task-summary">
          {jobs.filter((job) => !terminalStates.has(job.state)).length}{" "}
          个活动任务
        </p>
      </header>
      {message && <p role="status">{message}</p>}
      {jobs.length === 0 ? (
        <p className="empty">暂时没有后台任务。</p>
      ) : (
        <ol className="task-list">
          {jobs.map((job) => (
            <li className="task-card" key={job.job_id}>
              <div className="task-heading">
                <div>
                  <strong>{job.kind}</strong>
                  <code>{job.job_id}</code>
                </div>
                <span data-state={job.state}>{stateLabels[job.state]}</span>
              </div>
              <dl className="task-facts">
                <div>
                  <dt>阶段</dt>
                  <dd>{job.phase}</dd>
                </div>
                <div>
                  <dt>尝试</dt>
                  <dd>
                    第 {job.attempt} 次
                    {job.retry_of_job_id && <> · 接续 {job.retry_of_job_id}</>}
                  </dd>
                </div>
                <div>
                  <dt>创建</dt>
                  <dd>{new Date(job.created_at).toLocaleString("zh-CN")}</dd>
                </div>
              </dl>
              {Object.keys(job.progress).length > 0 && (
                <dl className="task-progress">
                  {Object.entries(job.progress).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {job.error_class && (
                <p className="task-error">
                  {job.error_class} · {job.error_code ?? "UNKNOWN_FAILURE"}
                </p>
              )}
              <div className="task-actions">
                {!terminalStates.has(job.state) && (
                  <button
                    disabled={busyId === job.job_id}
                    onClick={() => void mutate(job, "cancel")}
                    type="button"
                  >
                    请求取消
                  </button>
                )}
                {["canceled", "failed", "interrupted"].includes(job.state) && (
                  <button
                    disabled={busyId === job.job_id}
                    onClick={() => void mutate(job, "retry")}
                    type="button"
                  >
                    显式重试
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
