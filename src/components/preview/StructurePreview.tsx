import { useCallback, useEffect, useState } from "react";

import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { PublishPanel } from "./PublishPanel";
import { StructureEditor } from "./StructureEditor";

interface PreviewHeading {
  readonly block_id: string;
  readonly display_level: number;
  readonly include_in_toc: boolean;
  readonly role: "frontmatter" | "body" | "appendix" | "backmatter";
  readonly source_level: number;
  readonly starts_page: boolean;
  readonly source_title?: string;
  readonly title: string;
}

interface PreviewPage {
  readonly page_id: number;
  readonly title: string;
}

interface PreviewDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly severity?: "error" | "info" | "warning";
}

interface PreviewRegion {
  readonly applied: boolean;
  readonly end_byte: number;
  readonly entry_count: number;
  readonly matched_heading_count: number;
  readonly region_id: string;
  readonly start_byte: number;
}

interface TypographySummary {
  readonly profile: "preserve-v1" | "zh-smart-v1";
  readonly protected_nodes: number;
  readonly punctuation_converted: number;
  readonly spaces_normalized: number;
}

interface DraftView {
  readonly book_id: number;
  readonly config: Readonly<Record<string, unknown>> & {
    readonly title?: string;
  };
  readonly config_revision: number;
  readonly diagnostics: readonly PreviewDiagnostic[];
  readonly preview: {
    readonly compiler_version: string;
    readonly config_sha256: string;
    readonly config_revision: number;
    readonly headings: readonly PreviewHeading[];
    readonly is_stale: boolean;
    readonly pages: readonly PreviewPage[];
    readonly renderer_version: string;
    readonly semantic_digest: string;
    readonly source_regions: readonly PreviewRegion[];
    readonly source_sha256: string;
    readonly typography?: TypographySummary;
  } | null;
  readonly preview_state: "building" | "failed" | "ready";
}

const roleLabels: Readonly<Record<PreviewHeading["role"], string>> = {
  appendix: "附录",
  backmatter: "后置内容",
  body: "正文",
  frontmatter: "前置内容",
};

export function StructurePreview(props: { readonly bookId: number }) {
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [message, setMessage] = useState("");
  const [etag, setEtag] = useState("");
  const [selectedPage, setSelectedPage] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/manage/books/${props.bookId}/draft`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("DRAFT_LOAD_FAILED");
    const next = (await response.json()) as DraftView;
    setEtag(response.headers.get("etag") ?? "");
    setDraft(next);
    setSelectedPage(
      (current) => current ?? next.preview?.pages.at(0)?.page_id ?? null,
    );
  }, [props.bookId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setMessage("无法读取草稿预览。"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (draft?.preview_state !== "building") return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => setMessage("预览状态刷新失败。"));
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [draft?.preview_state, refresh]);

  if (!draft) {
    return <p role="status">{message || "正在读取草稿…"}</p>;
  }

  const preview = draft.preview;
  const pageId = preview?.pages.some((page) => page.page_id === selectedPage)
    ? selectedPage
    : (preview?.pages.at(0)?.page_id ?? null);

  return (
    <div className="preview-workspace">
      <header className="preview-header">
        <p className="eyebrow">草稿结构预览</p>
        <h1>{draft.config.title || `图书 ${draft.book_id}`}</h1>
        <p>
          配置修订 {draft.config_revision} ·{" "}
          {draft.preview_state === "building"
            ? "后台正在生成新预览"
            : draft.preview_state === "failed"
              ? "预览构建失败"
              : "预览已就绪"}
        </p>
        {preview?.is_stale && (
          <p className="stale" role="status">
            当前显示的是已完成的修订 {preview.config_revision}；修订{" "}
            {draft.config_revision} 正在后台重建。
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </header>

      <div className="preview-grid">
        <aside className="structure-panel" aria-labelledby="structure-title">
          <h2 id="structure-title">目录提议</h2>
          {!preview ? (
            <p className="quiet">预览尚未生成。此页面会自动刷新。</p>
          ) : (
            <ol className="heading-list">
              {preview.headings.map((heading) => (
                <li
                  key={heading.block_id}
                  style={{
                    marginInlineStart: `${(heading.display_level - 1) * 0.8}rem`,
                  }}
                >
                  <strong>{heading.title}</strong>
                  <span>
                    H{heading.source_level} → H{heading.display_level} ·{" "}
                    {roleLabels[heading.role]}
                    {heading.include_in_toc ? " · 目录" : " · 不入目录"}
                    {heading.starts_page ? " · 新页面" : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {preview && preview.pages.length > 0 && (
            <label>
              预览页面
              <select
                value={pageId ?? ""}
                onChange={(event) =>
                  setSelectedPage(Number(event.target.value))
                }
              >
                {preview.pages.map((page) => (
                  <option key={page.page_id} value={page.page_id}>
                    {page.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {preview?.typography && (
            <section aria-labelledby="typography-summary-title">
              <h2 id="typography-summary-title">Markdown 预处理</h2>
              <p>
                {preview.typography.profile} · 补齐空格{" "}
                {preview.typography.spaces_normalized} · 转换标点{" "}
                {preview.typography.punctuation_converted} · 保护节点{" "}
                {preview.typography.protected_nodes}
              </p>
            </section>
          )}
          {preview && preview.source_regions.length > 0 && (
            <section aria-labelledby="source-region-title">
              <h2 id="source-region-title">印刷目录区域</h2>
              <ul>
                {preview.source_regions.map((region) => (
                  <li key={region.region_id}>
                    {region.applied ? "已排除正文" : "未应用"} ·{" "}
                    {region.matched_heading_count}/{region.entry_count} 条目匹配
                    · 字节 {region.start_byte}–{region.end_byte}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <DiagnosticsPanel diagnostics={draft.diagnostics} />
          <PublishPanel
            bookId={draft.book_id}
            configRevision={draft.config_revision}
            previewReady={
              draft.preview_state === "ready" &&
              preview?.config_revision === draft.config_revision
            }
            previewStale={preview?.is_stale ?? false}
          />
          {etag && (
            <StructureEditor
              key={draft.config_revision}
              bookId={draft.book_id}
              config={draft.config}
              etag={etag}
              headings={preview?.headings ?? []}
              onSaved={refresh}
            />
          )}
        </aside>

        <section className="document-panel" aria-labelledby="document-title">
          <h2 id="document-title">正文效果</h2>
          {preview && pageId !== null ? (
            <iframe
              key={`${preview.config_revision}:${pageId}`}
              sandbox=""
              src={`/api/manage/books/${draft.book_id}/preview/${preview.config_revision}/pages/${pageId}`}
              title={`修订 ${preview.config_revision}：${preview.pages.find((page) => page.page_id === pageId)?.title ?? "正文预览"}`}
            />
          ) : (
            <p className="quiet">后台完成后将在这里显示净化后的正文。</p>
          )}
        </section>
      </div>
    </div>
  );
}
