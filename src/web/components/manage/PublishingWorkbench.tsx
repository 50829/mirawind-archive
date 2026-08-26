import { CircleAlert, FilePenLine, RotateCcw, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DiagnosticTarget } from "@/domain/errors";
import {
  manageDialog,
  manageDialogClose,
  manageDialogHeader,
  managePanel,
  manageQuietButton,
  manageSecondaryButton,
} from "../ui/manage-classes";
import { usePolling } from "./use-polling";

import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { BookSettingsDialog } from "./BookSettingsDialog";
import { PublishPanel } from "./PublishPanel";
import {
  StructureEditor,
  type StructureEditorHandle,
  type StructureEditorState,
} from "./StructureEditor";
import type {
  DraftView,
  PreviewPage,
  RecoveryJob,
} from "../../contracts/publishing";

const terminalJobStates = new Set<RecoveryJob["state"]>([
  "canceled",
  "failed",
  "interrupted",
  "succeeded",
]);

type PreviewFrameMessageType =
  | "mirawind-preview-location"
  | "mirawind-preview-navigate"
  | "mirawind-preview-ready"
  | "mirawind-preview-select-block";

interface PreviewFrameMessage {
  readonly block_id?: string;
  readonly fragment: string | null;
  readonly page_id: number;
  readonly revision: number;
  readonly type: PreviewFrameMessageType;
}

function previewFrameMessage(
  value: unknown,
  revision: number,
  pages: readonly PreviewPage[],
): PreviewFrameMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (
    candidate.type !== "mirawind-preview-location" &&
    candidate.type !== "mirawind-preview-navigate" &&
    candidate.type !== "mirawind-preview-ready" &&
    candidate.type !== "mirawind-preview-select-block"
  ) {
    return null;
  }
  if (
    candidate.revision !== revision ||
    !Number.isSafeInteger(candidate.page_id) ||
    !pages.some((page) => page.page_id === candidate.page_id)
  ) {
    return null;
  }
  if (
    candidate.fragment !== null &&
    (typeof candidate.fragment !== "string" ||
      candidate.fragment.length > 128 ||
      !/^[A-Za-z0-9_-]+$/u.test(candidate.fragment))
  ) {
    return null;
  }
  if (
    candidate.type === "mirawind-preview-select-block" &&
    (typeof candidate.block_id !== "string" ||
      !/^blk_[A-Za-z0-9_-]{16,80}$/u.test(candidate.block_id))
  ) {
    return null;
  }
  return candidate as unknown as PreviewFrameMessage;
}

interface DraftBlockEditor {
  readonly acceptedMarkdown: string;
  readonly blockId: string;
  readonly conflict: boolean;
  readonly error: string;
  readonly etag: string;
  readonly kind: string;
  readonly loading: boolean;
  readonly markdown: string;
  readonly saving: boolean;
}

interface DraftBlockResponse {
  readonly block_id: string;
  readonly kind: string;
  readonly markdown: string;
}

const blockKindLabels: Readonly<Record<string, string>> = Object.freeze({
  blockquote: "引用",
  code: "代码块",
  footnoteDefinition: "脚注",
  image: "图片",
  listItem: "列表项",
  math: "公式",
  paragraph: "段落",
  semanticContainer: "教材内容块",
  table: "表格",
});

export function PublishingWorkbench(props: { readonly bookId: number }) {
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [displayedPreview, setDisplayedPreview] =
    useState<DraftView["preview"]>(null);
  const [message, setMessage] = useState("");
  const [etag, setEtag] = useState("");
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [selectedFragment, setSelectedFragment] = useState<string | null>(null);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [reprocessJob, setReprocessJob] = useState<RecoveryJob | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [navigationSerial, setNavigationSerial] = useState(0);
  const [mobileMode, setMobileMode] = useState<"preview" | "structure">(
    "preview",
  );
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "phone">(
    "desktop",
  );
  const [editorState, setEditorState] = useState<StructureEditorState>({
    conflict: false,
    dirty: false,
    saving: false,
  });
  const [blockEditor, setBlockEditor] = useState<DraftBlockEditor | null>(null);
  const blockDirty = Boolean(
    blockEditor && blockEditor.markdown !== blockEditor.acceptedMarkdown,
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editorRef = useRef<StructureEditorHandle>(null);
  const diagnosticsDialog = useRef<HTMLDialogElement>(null);
  const diagnosticsDialogTrigger = useRef<HTMLButtonElement>(null);
  const blockDialog = useRef<HTMLDialogElement>(null);
  const updateEditorState = useCallback((next: StructureEditorState) => {
    setEditorState((current) =>
      current.conflict === next.conflict &&
      current.dirty === next.dirty &&
      current.saving === next.saving
        ? current
        : next,
    );
  }, []);

  const refresh = useCallback(async (): Promise<DraftView> => {
    const response = await fetch(`/api/manage/books/${props.bookId}/draft`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("DRAFT_LOAD_FAILED");
    const next = (await response.json()) as DraftView;
    setEtag(response.headers.get("etag") ?? "");
    setDraft(next);
    if (next.preview) {
      setDisplayedPreview(next.preview);
      setSelectedPage((current) =>
        next.preview?.pages.some((page) => page.page_id === current)
          ? current
          : (next.preview?.pages.at(0)?.page_id ?? null),
      );
    }
    return next;
  }, [props.bookId]);

  const preview = draft?.preview ?? displayedPreview;
  const previewIsCurrent = Boolean(
    draft?.preview && draft.preview.config_revision === draft.config_revision,
  );

  const loadBlock = useCallback(
    async (blockId: string) => {
      if (!draft || !previewIsCurrent || draft.candidate?.state !== "ready") {
        setMessage("当前预览正在更新，完成后才能编辑正文。");
        return;
      }
      setBlockEditor({
        acceptedMarkdown: "",
        blockId,
        conflict: false,
        error: "",
        etag: "",
        kind: "",
        loading: true,
        markdown: "",
        saving: false,
      });
      if (!blockDialog.current?.open) blockDialog.current?.showModal();
      try {
        const response = await fetch(
          `/api/manage/books/${draft.book_id}/draft/blocks/${blockId}`,
          { cache: "no-store", credentials: "same-origin" },
        );
        if (!response.ok) throw new Error("DRAFT_BLOCK_LOAD_FAILED");
        const value = (await response.json()) as DraftBlockResponse;
        const responseEtag = response.headers.get("etag");
        if (value.block_id !== blockId) throw new Error("DRAFT_BLOCK_MISMATCH");
        if (!responseEtag) throw new Error("DRAFT_BLOCK_ETAG_MISSING");
        setBlockEditor({
          acceptedMarkdown: value.markdown,
          blockId,
          conflict: false,
          error: "",
          etag: responseEtag,
          kind: value.kind,
          loading: false,
          markdown: value.markdown,
          saving: false,
        });
      } catch {
        setBlockEditor((current) =>
          current?.blockId === blockId
            ? {
                ...current,
                error: "无法读取这段正文。",
                loading: false,
              }
            : current,
        );
      }
    },
    [draft, previewIsCurrent],
  );

  const reloadBlock = useCallback(async () => {
    if (!blockEditor) return;
    const blockId = blockEditor.blockId;
    setBlockEditor((current) =>
      current
        ? { ...current, error: "", loading: true, saving: false }
        : current,
    );
    try {
      const [response] = await Promise.all([
        fetch(`/api/manage/books/${props.bookId}/draft/blocks/${blockId}`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
        refresh(),
      ]);
      if (!response.ok) throw new Error("DRAFT_BLOCK_RELOAD_FAILED");
      const value = (await response.json()) as DraftBlockResponse;
      const responseEtag = response.headers.get("etag");
      if (value.block_id !== blockId || !responseEtag) {
        throw new Error("DRAFT_BLOCK_RELOAD_MISMATCH");
      }
      setBlockEditor({
        acceptedMarkdown: value.markdown,
        blockId,
        conflict: false,
        error: "",
        etag: responseEtag,
        kind: value.kind,
        loading: false,
        markdown: value.markdown,
        saving: false,
      });
    } catch {
      setBlockEditor((current) =>
        current?.blockId === blockId
          ? {
              ...current,
              error: "无法重新载入当前正文，本地内容仍保留。",
              loading: false,
            }
          : current,
      );
    }
  }, [blockEditor, props.bookId, refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setMessage("无法读取草稿预览。"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  usePolling(
    draft?.candidate?.state === "building",
    async () => {
      await refresh().catch(() => setMessage("预览状态刷新失败。"));
    },
    1_000,
  );

  usePolling(
    Boolean(reprocessJob && !terminalJobStates.has(reprocessJob.state)),
    async () => {
      if (!reprocessJob) return;
      try {
        const response = await fetch(
          `/api/manage/jobs/${reprocessJob.job_id}`,
          { cache: "no-store", credentials: "same-origin" },
        );
        if (!response.ok) throw new Error("REPROCESS_STATUS_FAILED");
        const next = (await response.json()) as RecoveryJob;
        setReprocessJob(next);
        if (next.state === "succeeded") {
          setReprocessJob(null);
          setMessage("");
          await refresh();
        } else if (
          next.state === "failed" ||
          next.state === "interrupted" ||
          next.state === "canceled"
        ) {
          setMessage(
            `按原文重新处理未完成（${next.error_code ?? next.state}）。`,
          );
        }
      } catch {
        setMessage("重新处理状态刷新失败；可稍后重新载入。");
      }
    },
    1_000,
  );

  useEffect(() => {
    if (!preview) return;
    const receivePreviewMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const received = previewFrameMessage(
        event.data,
        preview.config_revision,
        preview.pages,
      );
      if (!received) return;
      if (received.type === "mirawind-preview-ready") {
        setFrameReady(true);
      }
      if (received.type === "mirawind-preview-navigate") {
        setFrameReady(false);
        setSelectedPage(received.page_id);
        setSelectedFragment(received.fragment);
        setNavigationSerial((value) => value + 1);
      }
      if (
        received.type === "mirawind-preview-select-block" &&
        received.block_id
      ) {
        void loadBlock(received.block_id);
      }
    };
    window.addEventListener("message", receivePreviewMessage);
    return () => window.removeEventListener("message", receivePreviewMessage);
  }, [loadBlock, preview]);

  const activateDiagnosticTarget = useCallback(
    async (target: DiagnosticTarget) => {
      diagnosticsDialog.current?.close();
      if (target.kind === "reprocess_verbatim") {
        setMessage("");
        if (
          !draft ||
          editorState.dirty ||
          editorState.conflict ||
          editorState.saving ||
          blockDirty ||
          blockEditor?.saving ||
          blockEditor?.conflict
        ) {
          setMessage("本地修改或冲突尚未处理，不能开始重新处理。");
          return;
        }
        try {
          const response = await fetch(
            `/api/manage/books/${draft.book_id}/reprocess`,
            {
              body: JSON.stringify({
                expected_config_revision: draft.config_revision,
                profile: "verbatim-v1",
              }),
              cache: "no-store",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              method: "POST",
            },
          );
          if (!response.ok) throw new Error("REPROCESS_FAILED");
          setReprocessJob((await response.json()) as RecoveryJob);
        } catch {
          setMessage("无法开始按原文重新处理。");
        }
        return;
      }
      setFrameReady(false);
      setSelectedPage(target.pageId);
      setSelectedFragment(target.blockId);
      setNavigationSerial((value) => value + 1);
      if (target.kind === "select_structure") {
        setFocusedBlockId(target.blockId);
        setMobileMode("structure");
      } else {
        setMobileMode("preview");
        await loadBlock(target.blockId);
      }
    },
    [blockDirty, blockEditor, draft, editorState, loadBlock],
  );

  const saveBlock = useCallback(async () => {
    if (
      !draft ||
      !blockEditor ||
      blockEditor.loading ||
      blockEditor.saving ||
      blockEditor.conflict ||
      blockEditor.markdown === blockEditor.acceptedMarkdown ||
      draft.candidate?.state !== "ready"
    ) {
      return;
    }
    setBlockEditor((current) =>
      current ? { ...current, error: "", saving: true } : current,
    );
    try {
      const response = await fetch(
        `/api/manage/books/${draft.book_id}/draft/blocks/${blockEditor.blockId}`,
        {
          body: JSON.stringify({ markdown: blockEditor.markdown }),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "If-Match": blockEditor.etag,
          },
          method: "PATCH",
        },
      );
      if (response.status === 412) {
        setBlockEditor((current) =>
          current
            ? {
                ...current,
                conflict: true,
                error:
                  "草稿已在其他页面更新。本地正文仍保留，请重新载入后再编辑。",
                saving: false,
              }
            : current,
        );
        return;
      }
      if (!response.ok) {
        setBlockEditor((current) =>
          current
            ? {
                ...current,
                error: "正文未保存，请检查 Markdown 后重试。",
                saving: false,
              }
            : current,
        );
        return;
      }
      blockDialog.current?.close();
      setBlockEditor(null);
      setMessage("");
      await refresh();
    } catch {
      setBlockEditor((current) =>
        current
          ? {
              ...current,
              error: "正文保存失败，请稍后重试。",
              saving: false,
            }
          : current,
      );
    }
  }, [blockEditor, draft, refresh]);

  if (!draft) {
    return (
      <p className={`${managePanel} mt-4`} role="status">
        {message || "正在读取草稿…"}
      </p>
    );
  }

  const pageId = preview?.pages.some((page) => page.page_id === selectedPage)
    ? selectedPage
    : (preview?.pages.at(0)?.page_id ?? null);
  const blockingDiagnostics = draft.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const candidateState = draft.candidate?.state ?? "failed";
  const previewReady =
    candidateState === "ready" &&
    preview?.config_revision === draft.config_revision;
  return (
    <div className="preview-workspace" data-mobile-mode={mobileMode}>
      <header className="preview-header sticky top-0 z-10 mb-4 grid min-h-18 grid-cols-[auto_minmax(12rem,1fr)_auto_auto_auto_auto] items-center gap-3 rounded-lg border border-stone-300 bg-white px-6 py-3 max-[850px]:grid-cols-[auto_minmax(0,1fr)_auto] max-[480px]:grid-cols-[minmax(0,1fr)_auto] max-[480px]:gap-2 max-[480px]:px-3">
        <a
          className="workbench-back font-semibold text-emerald-800 hover:text-emerald-900 max-[480px]:col-start-1 max-[480px]:row-start-1"
          href="/library"
        >
          返回书库
        </a>
        <div className="workbench-title min-w-0 max-[480px]:col-span-full max-[480px]:row-start-2">
          <h1 className="truncate text-base font-bold">{draft.title}</h1>
          {candidateState === "building" && (
            <p className="text-xs text-amber-800" role="status">
              正在生成阅读预览
            </p>
          )}
          {["canceled", "failed", "interrupted"].includes(candidateState) && (
            <p className="text-xs text-red-800" role="alert">
              预览构建失败
            </p>
          )}
          {(editorState.dirty || blockDirty) && (
            <p className="text-xs text-amber-800" role="status">
              本地修改尚未反映
            </p>
          )}
          {reprocessJob && !terminalJobStates.has(reprocessJob.state) && (
            <p className="text-xs text-amber-800" role="status">
              正在按原文重新处理
            </p>
          )}
          {message && (
            <p className="text-xs text-red-800" role="alert">
              {message}
            </p>
          )}
        </div>
        {draft.diagnostics.length > 0 && (
          <>
            <a
              className="workbench-issues workbench-issues-desktop font-semibold text-emerald-800 hover:text-emerald-900 max-[850px]:hidden"
              href="#workbench-diagnostics"
            >
              {draft.diagnostics.length} 个问题
            </a>
            <button
              aria-label={`${draft.diagnostics.length} 个问题`}
              className={`${manageSecondaryButton} workbench-issues-mobile min-[851px]:hidden max-[850px]:flex max-[480px]:col-start-2 max-[480px]:row-start-1 max-[480px]:justify-self-end`}
              onClick={() => diagnosticsDialog.current?.showModal()}
              ref={diagnosticsDialogTrigger}
              title={`${draft.diagnostics.length} 个问题`}
              type="button"
            >
              <CircleAlert aria-hidden="true" size={18} />
              <span aria-hidden="true">{draft.diagnostics.length}</span>
              <span className="sr-only">个问题</span>
            </button>
          </>
        )}
        <BookSettingsDialog
          disabled={
            editorState.dirty ||
            editorState.saving ||
            editorState.conflict ||
            blockDirty ||
            Boolean(blockEditor?.saving || blockEditor?.conflict) ||
            candidateState === "building"
          }
          draft={draft}
          etag={etag}
          onChanged={async () => {
            await refresh();
          }}
        />
        <button
          aria-label={editorState.saving ? "正在保存" : "保存并更新预览"}
          className={`${manageSecondaryButton} whitespace-nowrap max-[850px]:row-start-2 max-[480px]:col-start-2 max-[480px]:row-start-3`}
          disabled={
            !editorState.dirty ||
            editorState.saving ||
            editorState.conflict ||
            blockDirty ||
            blockEditor?.saving ||
            candidateState === "building"
          }
          onClick={() => editorRef.current?.save()}
          title={editorState.saving ? "正在保存" : "保存并更新预览"}
          type="button"
        >
          <Save aria-hidden="true" size={18} />
          <span className="max-[480px]:sr-only">
            {editorState.saving ? "正在保存" : "保存并更新预览"}
          </span>
        </button>
        <PublishPanel
          blocked={
            editorState.dirty ||
            blockDirty ||
            Boolean(blockEditor?.saving || blockEditor?.conflict) ||
            blockingDiagnostics.length > 0
          }
          bookId={draft.book_id}
          candidatePublished={draft.candidate_published}
          compact
          etag={etag}
          onPublished={async () => {
            await refresh();
          }}
          previewReady={previewReady}
          previewStale={preview?.is_stale ?? false}
        />
        <div
          aria-label="工作台视图"
          className="mobile-mode-switch col-span-full row-start-3 hidden gap-1 max-[850px]:flex max-[480px]:row-start-5"
        >
          <button
            aria-pressed={mobileMode === "preview"}
            className={manageQuietButton}
            onClick={() => setMobileMode("preview")}
            type="button"
          >
            预览
          </button>
          <button
            aria-pressed={mobileMode === "structure"}
            className={manageQuietButton}
            onClick={() => setMobileMode("structure")}
            type="button"
          >
            结构
          </button>
        </div>
      </header>

      <div className="preview-grid grid grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)] gap-4 max-[850px]:grid-cols-1">
        <aside
          className={`structure-panel ${managePanel} ${
            mobileMode === "preview" ? "max-[850px]:hidden" : ""
          }`}
          aria-labelledby="structure-title"
        >
          <h2 className="sr-only" id="structure-title">
            出版结构
          </h2>
          {etag && (
            <StructureEditor
              ref={editorRef}
              bookId={draft.book_id}
              boundaries={draft.boundaries}
              etag={etag}
              focusedBlockId={focusedBlockId}
              headings={preview?.headings ?? []}
              onSaved={async () => {
                await refresh();
              }}
              onStateChange={updateEditorState}
              numbering={draft.numbering}
              revision={draft.config_revision}
              saveDisabled={
                candidateState === "building" ||
                blockDirty ||
                Boolean(blockEditor?.saving || blockEditor?.conflict)
              }
              structure={draft.structure}
              typography={preview?.typography}
            />
          )}
          <div
            className="desktop-diagnostics max-[850px]:hidden"
            id="workbench-diagnostics"
          >
            <DiagnosticsPanel
              diagnostics={draft.diagnostics}
              onTarget={(target) => void activateDiagnosticTarget(target)}
              reprocessDisabled={
                editorState.dirty ||
                editorState.conflict ||
                editorState.saving ||
                blockDirty ||
                Boolean(blockEditor?.saving || blockEditor?.conflict)
              }
            />
          </div>
        </aside>

        <section
          aria-labelledby="document-title"
          className={`document-panel ${managePanel} sticky top-40 h-[calc(100vh-12rem)] overflow-hidden max-[850px]:static max-[850px]:h-[70vh] ${
            mobileMode === "structure" ? "max-[850px]:hidden" : ""
          }`}
          data-preview-width={previewWidth}
        >
          <div className="document-toolbar flex min-h-12 items-center gap-3">
            <h2 className="mr-auto text-base font-bold" id="document-title">
              正文预览
            </h2>
            <div aria-label="预览宽度" className="flex gap-1">
              <button
                aria-pressed={previewWidth === "desktop"}
                className={manageQuietButton}
                onClick={() => setPreviewWidth("desktop")}
                type="button"
              >
                桌面
              </button>
              <button
                aria-pressed={previewWidth === "phone"}
                className={manageQuietButton}
                onClick={() => setPreviewWidth("phone")}
                type="button"
              >
                手机
              </button>
            </div>
          </div>
          {preview && pageId !== null ? (
            <iframe
              aria-busy={!frameReady}
              className={`h-[calc(100%-3rem)] min-h-[32rem] w-full rounded-lg border border-stone-200 bg-white ${
                previewWidth === "phone"
                  ? "mx-auto block w-[min(390px,100%)]"
                  : ""
              }`}
              key={`${preview.config_revision}:${pageId}:${navigationSerial}`}
              ref={iframeRef}
              sandbox="allow-scripts"
              src={`/api/manage/books/${draft.book_id}/preview/${preview.config_revision}/pages/${pageId}${
                selectedFragment
                  ? `#${encodeURIComponent(selectedFragment)}`
                  : ""
              }`}
              title={`修订 ${preview.config_revision}：${preview.pages.find((page) => page.page_id === pageId)?.title ?? "正文预览"}`}
            />
          ) : (
            <p className="quiet text-sm text-stone-600">
              后台完成后将在这里显示净化后的正文。
            </p>
          )}
        </section>
      </div>

      {draft.diagnostics.length > 0 && (
        <dialog
          aria-labelledby="mobile-diagnostics-title"
          className={`workbench-mobile-dialog ${manageDialog}`}
          onClose={() => diagnosticsDialogTrigger.current?.focus()}
          ref={diagnosticsDialog}
        >
          <header className={manageDialogHeader}>
            <span id="mobile-diagnostics-title">问题</span>
            <button
              aria-label="关闭问题列表"
              className={manageDialogClose}
              onClick={() => diagnosticsDialog.current?.close()}
              title="关闭"
              type="button"
            >
              <X aria-hidden="true" size={20} />
            </button>
          </header>
          <div className="workbench-dialog-body p-4 max-[850px]:min-h-[calc(100dvh-3.5rem)] max-[850px]:overflow-auto">
            <DiagnosticsPanel
              diagnostics={draft.diagnostics}
              onTarget={(target) => void activateDiagnosticTarget(target)}
              reprocessDisabled={
                editorState.dirty ||
                editorState.conflict ||
                editorState.saving ||
                blockDirty ||
                Boolean(blockEditor?.saving || blockEditor?.conflict)
              }
            />
          </div>
        </dialog>
      )}

      <dialog
        aria-labelledby="draft-block-editor-title"
        className={`workbench-mobile-dialog ${manageDialog} w-[min(48rem,calc(100vw-2rem))]`}
        onCancel={(event) => {
          if (blockEditor?.saving) event.preventDefault();
        }}
        onClose={() => {
          setBlockEditor(null);
          iframeRef.current?.focus();
        }}
        ref={blockDialog}
      >
        <header className={manageDialogHeader}>
          <span id="draft-block-editor-title">
            编辑{blockKindLabels[blockEditor?.kind ?? ""] ?? "正文"}
          </span>
          <button
            aria-label="关闭正文编辑"
            className={manageDialogClose}
            disabled={blockEditor?.saving}
            onClick={() => blockDialog.current?.close()}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="workbench-dialog-body grid gap-4 p-4">
          {blockEditor?.loading ? (
            <p role="status">正在读取正文…</p>
          ) : blockEditor ? (
            <>
              <label className="grid gap-2 font-semibold">
                Markdown
                <textarea
                  autoFocus
                  className="min-h-80 w-full resize-y rounded-md border border-stone-300 bg-white p-3 font-mono text-sm leading-6 text-stone-900 focus-visible:border-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                  onChange={(event) => {
                    const markdown = event.currentTarget.value;
                    setBlockEditor((current) =>
                      current ? { ...current, markdown } : current,
                    );
                  }}
                  spellCheck={false}
                  value={blockEditor.markdown}
                />
              </label>
              {blockEditor.error && (
                <p className="text-sm text-red-800" role="alert">
                  {blockEditor.error}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                {blockEditor.conflict && (
                  <button
                    className={manageSecondaryButton}
                    disabled={blockEditor.loading}
                    onClick={() => void reloadBlock()}
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" size={18} />
                    放弃本地修改并重新载入
                  </button>
                )}
                <button
                  className={manageQuietButton}
                  disabled={blockEditor.saving}
                  onClick={() => blockDialog.current?.close()}
                  type="button"
                >
                  取消
                </button>
                <button
                  className={manageSecondaryButton}
                  disabled={
                    blockEditor.loading ||
                    blockEditor.saving ||
                    blockEditor.conflict ||
                    blockEditor.markdown === blockEditor.acceptedMarkdown ||
                    candidateState !== "ready"
                  }
                  onClick={() => void saveBlock()}
                  type="button"
                >
                  <FilePenLine aria-hidden="true" size={18} />
                  {blockEditor.saving ? "正在保存" : "保存正文并更新预览"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
