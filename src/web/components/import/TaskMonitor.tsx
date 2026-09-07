import { useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  FileArchive,
  RotateCcw,
  Wrench,
  XCircle,
} from "lucide-react";

import { usePolling } from "../manage/use-polling";
import {
  managePanel,
  managePrimaryButton,
  manageQuietButton,
  manageQuietText,
} from "../ui/manage-classes";
import type { JobProgress } from "@/entrypoints/worker/protocol";
import {
  jobOperationLabel,
  jobPhaseLabel,
  jobProgressDetail,
  jobProgressPercent,
  jobProgressSummary,
} from "./job-presentation";

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
const actionableStates = new Set<JobState>([
  "canceled",
  "failed",
  "interrupted",
]);
const completedHistoryLimit = 8;
const quietMaintenanceKinds = new Set([
  "reclaim",
  "reconcile",
  "verify_version",
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

function visibleJobs(jobs: readonly TaskView[]): readonly TaskView[] {
  return newestFirst(jobs).filter(
    (job) => !quietMaintenanceKinds.has(job.kind),
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

function TaskCard(props: {
  readonly busyId: string | null;
  readonly job: TaskView;
  readonly onAction: (job: TaskView, action: "cancel" | "retry") => void;
}) {
  const { job } = props;
  const percent = jobProgressPercent(job.state, job.progress);
  const detail = jobProgressDetail(job.progress);
  return (
    <li className={`task-card ${managePanel}`} data-job-id={job.job_id}>
      <div className="task-heading flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-stone-900">
            {jobOperationLabel(job.kind)}
          </h3>
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

      {!terminalStates.has(job.state) && (
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
            {detail && <span className="text-sm text-stone-600">{detail}</span>}
          </div>
        </div>
      )}

      <p className="mt-3 text-sm text-stone-600">
        第 {job.attempt} 次 · {new Date(job.created_at).toLocaleString("zh-CN")}
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
            disabled={props.busyId === job.job_id}
            onClick={() => props.onAction(job, "cancel")}
            type="button"
          >
            <XCircle aria-hidden="true" size={18} />
            取消
          </button>
        )}
        {actionableStates.has(job.state) && (
          <button
            className={managePrimaryButton}
            disabled={props.busyId === job.job_id}
            onClick={() => props.onAction(job, "retry")}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={18} />
            重试
          </button>
        )}
      </div>
    </li>
  );
}

function TaskGroup(props: {
  readonly busyId: string | null;
  readonly headingId: string;
  readonly jobs: readonly TaskView[];
  readonly onAction: (job: TaskView, action: "cancel" | "retry") => void;
  readonly title: string;
}) {
  if (props.jobs.length === 0) return null;
  return (
    <section aria-labelledby={props.headingId} className="mt-8">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-bold text-stone-900" id={props.headingId}>
          {props.title}
        </h2>
        <span className={manageQuietText}>{props.jobs.length} 项</span>
      </div>
      <ol className="task-list mt-3 grid list-none gap-4 p-0">
        {props.jobs.map((job) => (
          <TaskCard
            busyId={props.busyId}
            job={job}
            key={job.job_id}
            onAction={props.onAction}
          />
        ))}
      </ol>
    </section>
  );
}

export function TaskMonitor(props: {
  readonly initialJobs: readonly TaskView[];
}) {
  const [jobs, setJobs] = useState(() => visibleJobs(props.initialJobs));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const activeIds = useMemo(
    () =>
      jobs
        .filter((job) => !terminalStates.has(job.state))
        .map((job) => job.job_id),
    [jobs],
  );
  const groupedJobs = useMemo(() => {
    const active: TaskView[] = [];
    const actionable: TaskView[] = [];
    const completed: TaskView[] = [];
    for (const job of jobs) {
      if (!terminalStates.has(job.state)) active.push(job);
      else if (actionableStates.has(job.state)) actionable.push(job);
      else completed.push(job);
    }
    return Object.freeze({
      actionable: Object.freeze(actionable),
      active: Object.freeze(active),
      completed: Object.freeze(completed),
    });
  }, [jobs]);
  const visibleCompleted = showAllCompleted
    ? groupedJobs.completed
    : groupedJobs.completed.slice(0, completedHistoryLimit);
  const hiddenCompletedCount =
    groupedJobs.completed.length - visibleCompleted.length;

  async function refreshOne(jobId: string): Promise<void> {
    const response = await fetch(`/api/manage/jobs/${jobId}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("JOB_STATUS_FAILED");
    const next = (await response.json()) as TaskView;
    setJobs((current) =>
      visibleJobs(
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
        visibleJobs(
          current.map((item) =>
            item.job_id === canceled.job_id ? canceled : item,
          ),
        ),
      );
      setMessage(canceled.state === "canceled" ? "" : "正在取消…");
    } else if ("job_id" in body && body.job_id) {
      const statusResponse = await fetch(`/api/manage/jobs/${body.job_id}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (statusResponse.ok) {
        const retry = (await statusResponse.json()) as TaskView;
        setJobs((current) => visibleJobs([retry, ...current]));
      }
      setMessage("已重新排队");
    }
    setBusyId(null);
  }

  return (
    <section className="task-monitor" aria-labelledby="task-monitor-title">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="mt-1 text-2xl font-bold" id="task-monitor-title">
            任务与恢复
          </h1>
        </div>
        <p className="task-summary text-right text-sm text-stone-600">
          {groupedJobs.active.length} 个活动任务
          {groupedJobs.actionable.length > 0 && (
            <>
              <br />
              {groupedJobs.actionable.length} 个需要处理
            </>
          )}
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
        <>
          <TaskGroup
            busyId={busyId}
            headingId="active-tasks-heading"
            jobs={groupedJobs.active}
            onAction={(job, action) => void mutate(job, action)}
            title="活动任务"
          />
          <TaskGroup
            busyId={busyId}
            headingId="actionable-tasks-heading"
            jobs={groupedJobs.actionable}
            onAction={(job, action) => void mutate(job, action)}
            title="需要处理"
          />
          {groupedJobs.completed.length > 0 && (
            <section aria-labelledby="completed-tasks-heading" className="mt-8">
              <div className="flex items-baseline justify-between gap-4">
                <h2
                  className="text-lg font-bold text-stone-900"
                  id="completed-tasks-heading"
                >
                  最近完成
                </h2>
                <span className={manageQuietText}>
                  显示 {visibleCompleted.length} /{" "}
                  {groupedJobs.completed.length}
                </span>
              </div>
              <ol className="task-list mt-3 grid list-none gap-4 p-0">
                {visibleCompleted.map((job) => (
                  <TaskCard
                    busyId={busyId}
                    job={job}
                    key={job.job_id}
                    onAction={(target, action) => void mutate(target, action)}
                  />
                ))}
              </ol>
              {groupedJobs.completed.length > completedHistoryLimit && (
                <div className="mt-4 flex justify-center">
                  <button
                    className={manageQuietButton}
                    onClick={() => setShowAllCompleted((current) => !current)}
                    type="button"
                  >
                    {showAllCompleted ? (
                      <ChevronUp aria-hidden="true" size={18} />
                    ) : (
                      <ChevronDown aria-hidden="true" size={18} />
                    )}
                    {showAllCompleted
                      ? "收起已完成任务"
                      : `显示其余 ${hiddenCompletedCount} 个已完成任务`}
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
