import { type ComponentProps, useEffect, useState } from "react";

import { CandidateReview, type CandidateView } from "./CandidateReview";

type FormSubmitEvent = Parameters<
  NonNullable<ComponentProps<"form">["onSubmit"]>
>[0];

interface ImportView {
  readonly book_id: number | null;
  readonly candidates: readonly CandidateView[];
  readonly current_job_id: string | null;
  readonly error_code: string | null;
  readonly import_id: string;
  readonly state: string;
}

interface JobView {
  readonly attempt: number;
  readonly error_class: string | null;
  readonly error_code: string | null;
  readonly job_id: string;
  readonly phase: string;
  readonly progress: Readonly<Record<string, boolean | number | string | null>>;
  readonly state: string;
}

export function ImportUploader() {
  const [busy, setBusy] = useState(false);
  const [jobView, setJobView] = useState<JobView | null>(null);
  const [message, setMessage] = useState("");
  const [importView, setImportView] = useState<ImportView | null>(null);

  async function refresh(importId: string) {
    const response = await fetch(`/api/manage/imports/${importId}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("IMPORT_STATUS_FAILED");
    const next = (await response.json()) as ImportView;
    setImportView(next);
    if (next.current_job_id) {
      const jobResponse = await fetch(
        `/api/manage/jobs/${next.current_job_id}`,
        {
          cache: "no-store",
          credentials: "same-origin",
        },
      );
      if (jobResponse.ok) setJobView((await jobResponse.json()) as JobView);
    }
  }

  useEffect(() => {
    if (
      !importView ||
      ["draft_ready", "rejected", "canceled", "expired"].includes(
        importView.state,
      )
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh(importView.import_id).catch(() =>
        setMessage("状态刷新失败，请稍后重试。"),
      );
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [importView]);

  async function upload(event: FormSubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/manage/imports", {
      body: new FormData(event.currentTarget),
      credentials: "same-origin",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      method: "POST",
    });
    const body = (await response.json()) as {
      code?: string;
      import_id?: string;
    };
    if (!response.ok || !body.import_id) {
      setMessage(`上传失败：${body.code ?? "UPLOAD_FAILED"}`);
      setBusy(false);
      return;
    }
    await refresh(body.import_id);
    setBusy(false);
  }

  async function confirm(candidateId: string) {
    if (!importView) return;
    setBusy(true);
    const response = await fetch(
      `/api/manage/imports/${importView.import_id}/main-markdown`,
      {
        body: JSON.stringify({ candidate_id: candidateId }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { code?: string };
      setMessage(`确认失败：${body.code ?? "CONFIRM_FAILED"}`);
    } else {
      await refresh(importView.import_id);
    }
    setBusy(false);
  }

  return (
    <div className="import-workspace">
      <form className="upload-card" onSubmit={upload}>
        <p className="eyebrow">MinerU 导入</p>
        <h1>准备一本书</h1>
        <p>一次上传一个 ZIP。解析、图片检查和预览都在后台完成。</p>
        <label>
          MinerU ZIP
          <input
            accept=".zip,application/zip"
            name="file"
            required
            type="file"
          />
        </label>
        <label>
          更新已有书籍（可选）
          <input min="1" name="target_book_id" type="number" />
        </label>
        <button disabled={busy} type="submit">
          {busy ? "处理中…" : "上传并分析"}
        </button>
        {message && <p role="status">{message}</p>}
      </form>

      {importView && (
        <section className="status-card" aria-live="polite">
          <h2>导入状态</h2>
          <p>
            <code>{importView.import_id}</code> · {importView.state}
          </p>
          {importView.error_code && (
            <p className="diagnostic">{importView.error_code}</p>
          )}
          {jobView && (
            <div className="job-progress">
              <p>
                后台任务：{jobView.state} · {jobView.phase} · 第{" "}
                {jobView.attempt} 次尝试
              </p>
              {Object.keys(jobView.progress).length > 0 && (
                <dl>
                  {Object.entries(jobView.progress).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {jobView.error_class && (
                <p className="diagnostic">
                  {jobView.error_class} · {jobView.error_code}
                </p>
              )}
            </div>
          )}
          {importView.book_id && importView.state === "draft_ready" && (
            <a href={`/manage/books/${importView.book_id}/preview`}>
              打开结构预览
            </a>
          )}
          <CandidateReview
            candidates={importView.candidates}
            confirmable={importView.state === "needs_main_confirmation"}
            disabled={busy}
            onConfirm={confirm}
          />
        </section>
      )}
    </div>
  );
}
