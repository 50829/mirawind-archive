import { useMemo, useState } from "react";
import {
  BookOpen,
  FileArchive,
  RotateCcw,
  Wrench,
  XCircle,
} from "lucide-react";

import { usePolling } from "@/web/components/manage/use-polling";
import {
  managePanel,
  managePrimaryButton,
  manageQuietText,
} from "@/web/components/ui/manage-classes";
import type { JobProgress } from "@/entrypoints/worker/protocol";
import {
  jobOperationLabel,
  jobPhaseLabel,
  jobProgressDetail,
  jobProgressPercent,
  jobProgressSummary,
} from "@/web/components/import/job-presentation";

type JobState =
  "canceled" | "failed" | "interrupted" | "queued" | "running" | "succeeded";

export interface TaskView {
  readonly attempt: number;
  readonly automatic_retry_count: number;
  readonly cancellation_requested_at: string | null;
  readonly created_at: string;
  readonly error_class: string | null;
  readonly error_code: string | null;
  readonly finished_at: string | null;
  readonly job_id: string;
  readonly kind: string;
  readonly phase: string;
  readonly progress: JobProgress;
  readonly retry_of_job_id: string | null;
  readonly started_at: string | null;
  readonly state: JobState;
  readonly subject: {
    readonly kind: "book" | "import" | "system";
    readonly label: string;
  };
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

function stateClass(state: JobState): string {
  if (state === "failed") return "bg-red-100 text-red-900";
  if (state === "interrupted" || state === "canceled") {
    return "bg-stone-200 text-stone-800";
  }
  if (state === "queued") return "bg-amber-100 text-amber-900";
  return "bg-emerald-100 text-emerald-900";
}

function SubjectIcon(props: { readonly kind: TaskView["subject"]["kind"] }) {
  if (props.kind === "book") return <BookOpen aria-hidden="true" size={18} />;
  if (props.kind === "import") {
    return <FileArchive aria-hidden="true" size={18} />;
  }
  return <Wrench aria-hidden="true" size={18} />;
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

  usePolling(activeIds.length > 0, async () => {
    await Promise.all(activeIds.map(refreshOne)).catch(() =>
      setMessage("任务状态刷新失败，请稍后重试。"),
    );
  });

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
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow text-sm font-semibold text-emerald-800">
            后台工作
          </p>
          <h1 className="mt-1 text-2xl font-bold" id="task-monitor-title">
            任务与恢复
          </h1>
        </div>
        <p className="task-summary text-sm text-stone-600">
          {jobs.filter((job) => !terminalStates.has(job.state)).length}{" "}
          个活动任务
        </p>
      </header>
      {message && (
        <p className="mt-4 text-sm text-stone-700" role="status">
          {message}
        </p>
      )}
      {jobs.length === 0 ? (
        <p className={`empty mt-6 ${manageQuietText}`}>暂时没有后台任务。</p>
      ) : (
        <ol className="task-list mt-6 grid list-none gap-4 p-0">
          {jobs.map((job) => {
            const percent = jobProgressPercent(job.state, job.progress);
            const detail = jobProgressDetail(job.progress);
            return (
              <li
                className={`task-card ${managePanel}`}
                data-job-id={job.job_id}
                key={job.job_id}
              >
                <div className="task-heading flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-stone-900">
                      {jobOperationLabel(job.kind)}
                    </h2>
                    <p className="mt-1 flex min-w-0 items-center gap-2 text-stone-700">
                      <SubjectIcon kind={job.subject.kind} />
                      <span className="truncate">{job.subject.label}</span>
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${stateClass(job.state)}`}
                    data-state={job.state}
                  >
                    {stateLabels[job.state]}
                  </span>
                </div>

                <div
                  aria-label={
                    percent === null ? "任务进度未知" : `任务进度 ${percent}%`
                  }
                  className="mt-4"
                >
                  <progress
                    className="h-2 w-full accent-emerald-700"
                    max={100}
                    {...(percent === null ? {} : { value: percent })}
                  />
                  <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                    <strong className="text-stone-800">
                      {jobProgressSummary(job)}
                    </strong>
                    {detail && (
                      <span className="text-sm text-stone-600">{detail}</span>
                    )}
                  </div>
                </div>

                <p className="mt-3 text-sm text-stone-600">
                  第 {job.attempt} 次 ·{" "}
                  {new Date(job.created_at).toLocaleString("zh-CN")}
                </p>
                {job.error_class && (
                  <p className="task-error mt-3 text-red-800">
                    {job.error_class} · {job.error_code ?? "UNKNOWN_FAILURE"}
                  </p>
                )}

                <details className="mt-3 border-t border-stone-200 pt-3 text-sm text-stone-600">
                  <summary className="cursor-pointer font-medium text-stone-700">
                    技术详情
                  </summary>
                  <dl className="mt-2 grid gap-1">
                    <div>
                      <dt className="inline">阶段：</dt>
                      <dd className="inline">
                        {jobPhaseLabel(job.phase)} ({job.phase})
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">任务：</dt>
                      <dd className="inline">
                        <code>{job.job_id}</code>
                      </dd>
                    </div>
                    {job.retry_of_job_id && (
                      <div>
                        <dt className="inline">接续：</dt>
                        <dd className="inline">
                          <code>{job.retry_of_job_id}</code>
                        </dd>
                      </div>
                    )}
                  </dl>
                </details>

                <div className="task-actions mt-4 flex items-center justify-end gap-2">
                  {!terminalStates.has(job.state) && (
                    <button
                      className={managePrimaryButton}
                      disabled={busyId === job.job_id}
                      onClick={() => void mutate(job, "cancel")}
                      type="button"
                    >
                      <XCircle aria-hidden="true" size={18} />
                      请求取消
                    </button>
                  )}
                  {["canceled", "failed", "interrupted"].includes(
                    job.state,
                  ) && (
                    <button
                      className={managePrimaryButton}
                      disabled={busyId === job.job_id}
                      onClick={() => void mutate(job, "retry")}
                      type="button"
                    >
                      <RotateCcw aria-hidden="true" size={18} />
                      显式重试
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
