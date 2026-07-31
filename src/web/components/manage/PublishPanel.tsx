import { useState } from "react";

import {
  managePrimaryButton,
  manageQuietText,
} from "@/web/components/ui/manage-classes";

export function PublishPanel(props: {
  readonly blocked?: boolean;
  readonly bookId: number;
  readonly candidatePublished: boolean;
  readonly compact?: boolean;
  readonly etag: string;
  readonly onPublished: () => Promise<void>;
  readonly previewReady: boolean;
  readonly previewStale: boolean;
}) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function publish() {
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/manage/books/${props.bookId}/publish`,
        {
          body: JSON.stringify({}),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "If-Match": props.etag,
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        setMessage(
          response.status === 412
            ? "草稿已更新，请重新载入后再发布。"
            : response.status === 409
              ? "当前候选已过期或存在阻断问题。"
              : "无法发布，请稍后重试。",
        );
        return;
      }
      await props.onPublished();
    } catch {
      setMessage("无法发布，请检查网络后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  const canPublish =
    props.previewReady &&
    Boolean(props.etag) &&
    !props.previewStale &&
    !props.blocked &&
    !submitting &&
    !props.candidatePublished;

  return (
    <section
      aria-label="发布"
      className={`publish-panel ${
        props.compact
          ? "publish-panel-compact flex items-center gap-2 max-[850px]:row-start-2"
          : ""
      }`}
    >
      <button
        className={`${managePrimaryButton} whitespace-nowrap`}
        disabled={!canPublish}
        onClick={() => void publish()}
        type="button"
      >
        {submitting
          ? "正在发布"
          : props.candidatePublished
            ? "已发布"
            : "发布当前修订"}
      </button>
      {props.candidatePublished && (
        <a
          className="font-semibold text-emerald-800 hover:text-emerald-900"
          href={`/read/${props.bookId}`}
        >
          开始阅读
        </a>
      )}
      {!props.previewReady && (
        <p className={`quiet max-w-72 ${manageQuietText}`}>
          预览完成并通过校验后才能发布。
        </p>
      )}
      {props.previewStale && (
        <p className="stale max-w-72 text-sm text-amber-800">
          当前预览已过期，请等待最新修订重建完成。
        </p>
      )}
      {message && (
        <p className="max-w-72 text-sm text-red-800" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
