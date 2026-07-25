import { useEffect, useState } from "react";

type TypographyProfile = "preserve-v1" | "zh-smart-v1";

export function TypographyReprocessPanel(props: {
  readonly bookId: number;
  readonly configRevision: number;
  readonly currentProfile: TypographyProfile;
  readonly onSourceChanged: () => Promise<void>;
  readonly originalFileId: string;
  readonly sourceId: string;
}) {
  const { onSourceChanged } = props;
  const [profile, setProfile] = useState<TypographyProfile>(
    props.currentProfile === "zh-smart-v1" ? "preserve-v1" : "zh-smart-v1",
  );
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/manage/jobs/${jobId}`, {
        cache: "no-store",
        credentials: "same-origin",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("JOB_STATUS_FAILED");
          const job = (await response.json()) as {
            readonly error_code: string | null;
            readonly state: string;
          };
          if (job.state === "succeeded") {
            window.clearInterval(timer);
            setJobId(null);
            setStatus("新的 Markdown 源修订已生成，正在构建预览。");
            await onSourceChanged();
          } else if (
            ["failed", "canceled", "interrupted"].includes(job.state)
          ) {
            window.clearInterval(timer);
            setJobId(null);
            setStatus(
              `重新排版未完成（${job.error_code ?? job.state}），当前草稿没有改变。`,
            );
          }
        })
        .catch(() => setStatus("重新排版任务状态读取失败。"));
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [jobId, onSourceChanged]);

  async function reprocess() {
    setSubmitting(true);
    setStatus("");
    try {
      const response = await fetch(
        `/api/manage/books/${props.bookId}/reprocess`,
        {
          body: JSON.stringify({
            expected_config_revision: props.configRevision,
            expected_source_id: props.sourceId,
            original_file_id: props.originalFileId,
            profile,
          }),
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        setStatus(
          response.status === 409
            ? "源或配置已经变化，请刷新后再试。"
            : "无法开始重新排版。",
        );
        return;
      }
      const accepted = (await response.json()) as {
        readonly job_id: string;
      };
      setJobId(accepted.job_id);
      setStatus("重新排版任务已进入后台队列。");
    } catch {
      setStatus("无法开始重新排版，请检查网络后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="typography-reprocess-title">
      <h2 id="typography-reprocess-title">重新排版 Markdown</h2>
      <p className="quiet">
        从保留的原始 ZIP 创建新的源和配置修订；不会覆盖当前 Markdown
        或任何已发布版本。
      </p>
      <label>
        排版规则
        <select
          value={profile}
          onChange={(event) =>
            setProfile(event.target.value as TypographyProfile)
          }
        >
          <option value="zh-smart-v1">中文智能混排</option>
          <option value="preserve-v1">保持原文</option>
        </select>
      </label>
      <button
        type="button"
        disabled={submitting || jobId !== null}
        onClick={() => void reprocess()}
      >
        {jobId ? "后台重新排版中…" : "创建新的排版源修订"}
      </button>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
