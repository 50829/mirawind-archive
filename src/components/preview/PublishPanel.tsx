import { useEffect, useRef, useState } from "react";

import { publicationPhaseLabel } from "./publication-phase.js";

interface JobStatus {
  readonly error_code: string | null;
  readonly job_id: string;
  readonly phase: string;
  readonly publication: {
    readonly book_id: number;
    readonly book_key: string;
    readonly details_url: string;
    readonly library_url: "/library";
    readonly start_url: string;
    readonly version_id: string;
  } | null;
  readonly state:
    "canceled" | "failed" | "interrupted" | "queued" | "running" | "succeeded";
}

const terminalStates = new Set([
  "canceled",
  "failed",
  "interrupted",
  "succeeded",
]);

export function PublishPanel(props: {
  readonly bookId: number;
  readonly configRevision: number;
  readonly initialJob?: JobStatus | null;
  readonly previewReady: boolean;
  readonly previewStale: boolean;
}) {
  const [job, setJob] = useState<JobStatus | null>(props.initialJob ?? null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!job || terminalStates.has(job.state)) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/manage/jobs/${job.job_id}`, {
        cache: "no-store",
        credentials: "same-origin",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("JOB_STATUS_FAILED");
          const status = (await response.json()) as JobStatus;
          setJob(status);
          if (status.state === "succeeded") {
            setMessage("发布完成；新请求现在读取完整的新版本。");
          } else if (
            status.state === "failed" ||
            status.state === "interrupted" ||
            status.state === "canceled"
          ) {
            setMessage(
              `发布未完成（${status.error_code ?? status.state}）；读者仍读取上一已发布版本。`,
            );
          }
        })
        .catch(() => setMessage("发布状态刷新失败；可稍后重新打开此页面。"));
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [job]);

  async function publish() {
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/manage/books/${props.bookId}/publish`,
        {
          body: JSON.stringify({
            expected_config_revision: props.configRevision,
          }),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey.current,
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        setMessage(
          response.status === 409
            ? "当前修订尚未通过预览校验，或已被新修订取代。"
            : "无法开始发布，请稍后重试。",
        );
        return;
      }
      const accepted = (await response.json()) as {
        readonly job_id: string;
        readonly state: "queued";
      };
      setJob({
        error_code: null,
        job_id: accepted.job_id,
        phase: "queued",
        publication: null,
        state: accepted.state,
      });
      idempotencyKey.current = crypto.randomUUID();
      setMessage("发布任务已进入后台队列；旧版本会持续正常提供。");
    } catch {
      setMessage("无法开始发布，请检查网络后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  const canPublish =
    props.previewReady &&
    !props.previewStale &&
    !submitting &&
    (!job || terminalStates.has(job.state));

  return (
    <section className="publish-panel" aria-labelledby="publish-title">
      <h2 id="publish-title">发布</h2>
      <p className="quiet">
        系统在后台构建并验证完整版本，成功后才原子切换；失败不会影响当前读者。
      </p>
      <button
        type="button"
        disabled={!canPublish}
        onClick={() => void publish()}
      >
        {submitting
          ? "正在提交…"
          : job && !terminalStates.has(job.state)
            ? `发布中：${publicationPhaseLabel(job.phase)}`
            : "发布当前修订"}
      </button>
      {!props.previewReady && (
        <p className="quiet">预览完成并通过校验后才能发布。</p>
      )}
      {props.previewStale && (
        <p className="stale">当前预览已过期，请等待最新修订重建完成。</p>
      )}
      {job?.state === "succeeded" && job.publication ? (
        <div className="publish-outcome" data-state="succeeded">
          <p>
            <strong>发布完成。</strong>{" "}
            当前版本已经原子切换，新的访问会读取这一版本。
          </p>
          <nav aria-label="发布完成后的操作">
            <a href={job.publication.details_url}>查看图书</a>
            <a href={job.publication.start_url}>开始阅读</a>
            <a href={job.publication.library_url}>返回书库</a>
          </nav>
        </div>
      ) : null}
      {job && ["canceled", "failed", "interrupted"].includes(job.state) ? (
        <div className="publish-outcome" data-state={job.state}>
          <p>
            发布未完成；上一已发布版本仍保持在线。可以检查任务原因、修订预览后再试。
          </p>
          <nav aria-label="发布失败后的操作">
            <a href="/manage/tasks">查看后台任务</a>
            <a href={`/manage/books/${props.bookId}/preview`}>返回预览</a>
          </nav>
        </div>
      ) : null}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
