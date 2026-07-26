import { CircleAlert, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  manageDialog,
  manageDialogClose,
  manageDialogHeader,
  manageField,
  managePanel,
  manageQuietButton,
  manageSecondaryButton,
} from "@/components/ui/manage-classes";
import { usePolling } from "@/components/manage/use-polling";

import { DiagnosticsPanel, type PreviewDiagnostic } from "./DiagnosticsPanel";
import { PublishPanel } from "./PublishPanel";
import {
  StructureEditor,
  type StructureEditorHandle,
  type StructureEditorState,
} from "./StructureEditor";

interface PreviewHeading {
  readonly block_id: string;
  readonly display_level: number;
  readonly include_in_toc: boolean;
  readonly page_id: number | null;
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

interface PreviewRegion {
  readonly applied: boolean;
  readonly block_id?: string;
  readonly end_byte: number;
  readonly entry_count: number;
  readonly matched_heading_count: number;
  readonly region_id: string;
  readonly start_byte: number;
}

interface TypographySummary {
  readonly profile: "verbatim-v1" | "zh-smart-v1";
  readonly protected_nodes: number;
  readonly punctuation_converted: number;
  readonly spaces_normalized: number;
}

interface DraftView {
  readonly book_id: number;
  readonly config_revision: number;
  readonly diagnostics: readonly PreviewDiagnostic[];
  readonly regions: readonly {
    readonly applied: boolean;
    readonly entry_count: number;
    readonly region_id: string;
  }[];
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
  readonly structure: readonly {
    readonly block_id: string;
    readonly display_level: number;
    readonly display_title?: string;
    readonly include_in_toc: boolean;
    readonly role?: "frontmatter" | "body" | "appendix" | "backmatter";
    readonly starts_page: boolean;
  }[];
  readonly title: string;
}

interface RecoveryJob {
  readonly error_code: string | null;
  readonly job_id: string;
  readonly state:
    "canceled" | "failed" | "interrupted" | "queued" | "running" | "succeeded";
}

const terminalJobStates = new Set<RecoveryJob["state"]>([
  "canceled",
  "failed",
  "interrupted",
  "succeeded",
]);

type PreviewFrameMessageType =
  | "mirawind-preview-location"
  | "mirawind-preview-navigate"
  | "mirawind-preview-ready";

interface PreviewFrameMessage {
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
    candidate.type !== "mirawind-preview-ready"
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
  return candidate as unknown as PreviewFrameMessage;
}

export function PublishingWorkbench(props: { readonly bookId: number }) {
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [message, setMessage] = useState("");
  const [etag, setEtag] = useState("");
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [selectedFragment, setSelectedFragment] = useState<string | null>(null);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [activeDiagnostic, setActiveDiagnostic] =
    useState<PreviewDiagnostic | null>(null);
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editorRef = useRef<StructureEditorHandle>(null);
  const diagnosticsDialog = useRef<HTMLDialogElement>(null);
  const diagnosticsDialogTrigger = useRef<HTMLButtonElement>(null);
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
    setSelectedPage(
      (current) => current ?? next.preview?.pages.at(0)?.page_id ?? null,
    );
    return next;
  }, [props.bookId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setMessage("无法读取草稿预览。"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  usePolling(
    draft?.preview_state === "building",
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
    const preview = draft?.preview;
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
    };
    window.addEventListener("message", receivePreviewMessage);
    return () => window.removeEventListener("message", receivePreviewMessage);
  }, [draft?.preview]);

  const pageForBlock = useCallback(
    (blockId: string) =>
      draft?.preview?.headings.find((heading) => heading.block_id === blockId)
        ?.page_id ?? null,
    [draft?.preview],
  );
  const activateDiagnostic = useCallback(
    (diagnostic: PreviewDiagnostic) => {
      const blockId =
        diagnostic.location?.blockId ??
        diagnostic.blockId ??
        draft?.preview?.source_regions.find(
          (region) =>
            region.region_id === diagnostic.location?.regionId &&
            region.block_id,
        )?.block_id;
      diagnosticsDialog.current?.close();
      setActiveDiagnostic(diagnostic);
      if (!blockId) {
        setMobileMode("structure");
        return;
      }
      const diagnosticPage = pageForBlock(blockId);
      setFocusedBlockId(blockId);
      setMobileMode("structure");
      if (diagnosticPage === null) return;
      setFrameReady(false);
      setSelectedPage(diagnosticPage);
      setSelectedFragment(blockId);
      setNavigationSerial((value) => value + 1);
      setMobileMode("preview");
    },
    [draft?.preview?.source_regions, pageForBlock],
  );

  const recoverDiagnostic = useCallback(
    async (
      action: NonNullable<PreviewDiagnostic["recovery"]>[number],
      diagnostic: PreviewDiagnostic,
    ) => {
      if (action === "select_structure") {
        activateDiagnostic(diagnostic);
        return;
      }
      setMessage("");
      if (action === "reload") {
        await refresh().catch(() => setMessage("重新载入草稿失败。"));
        return;
      }
      if (
        !draft ||
        editorState.dirty ||
        editorState.conflict ||
        editorState.saving
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
        const queued = (await response.json()) as RecoveryJob;
        setReprocessJob(queued);
      } catch {
        setMessage("无法开始按原文重新处理。");
      }
    },
    [activateDiagnostic, draft, editorState, refresh],
  );

  if (!draft) {
    return (
      <p className={`${managePanel} mt-4`} role="status">
        {message || "正在读取草稿…"}
      </p>
    );
  }

  const preview = draft.preview;
  const pageId = preview?.pages.some((page) => page.page_id === selectedPage)
    ? selectedPage
    : (preview?.pages.at(0)?.page_id ?? null);
  const blockingDiagnostics = draft.diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === "error" ||
      !["CODE_LANGUAGE_UNSUPPORTED", "MATH_RENDER_FAILED"].includes(
        diagnostic.code,
      ),
  );
  const previewReady =
    draft.preview_state === "ready" &&
    preview?.config_revision === draft.config_revision;
  return (
    <div className="preview-workspace" data-mobile-mode={mobileMode}>
      <header className="preview-header sticky top-0 z-10 mb-4 grid min-h-18 grid-cols-[auto_minmax(12rem,1fr)_auto_auto_auto] items-center gap-3 rounded-lg border border-stone-300 bg-white px-6 py-3 max-[850px]:grid-cols-[auto_minmax(0,1fr)_auto]">
        <a
          className="workbench-back font-semibold text-emerald-800 hover:text-emerald-900"
          href="/manage"
        >
          返回
        </a>
        <div className="workbench-title min-w-0">
          <h1 className="truncate text-base font-bold">{draft.title}</h1>
          {draft.preview_state === "building" && (
            <p className="text-xs text-amber-800" role="status">
              正在构建预览
            </p>
          )}
          {draft.preview_state === "failed" && (
            <p className="text-xs text-red-800" role="alert">
              预览构建失败
            </p>
          )}
          {editorState.dirty && (
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
              className={`${manageSecondaryButton} workbench-issues-mobile hidden max-[850px]:flex`}
              onClick={() => diagnosticsDialog.current?.showModal()}
              ref={diagnosticsDialogTrigger}
              type="button"
            >
              <CircleAlert aria-hidden="true" size={18} />
              {draft.diagnostics.length} 个问题
            </button>
          </>
        )}
        <button
          className={`${manageSecondaryButton} whitespace-nowrap max-[850px]:row-start-2`}
          disabled={
            !editorState.dirty ||
            editorState.saving ||
            editorState.conflict ||
            draft.preview_state === "building"
          }
          onClick={() => editorRef.current?.save()}
          type="button"
        >
          <Save aria-hidden="true" size={18} />
          {editorState.saving ? "正在保存" : "保存并重建"}
        </button>
        <PublishPanel
          blocked={editorState.dirty || blockingDiagnostics.length > 0}
          bookId={draft.book_id}
          compact
          configRevision={draft.config_revision}
          previewReady={previewReady}
          previewStale={preview?.is_stale ?? false}
        />
        <div
          aria-label="工作台视图"
          className="mobile-mode-switch col-span-full row-start-3 hidden gap-1 max-[850px]:flex"
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
          {activeDiagnostic?.location && (
            <p
              className="mb-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
              role="status"
            >
              {activeDiagnostic.location.regionId
                ? `区域 ${activeDiagnostic.location.regionId}`
                : activeDiagnostic.location.pageIndex !== undefined
                  ? `原 PDF 第 ${activeDiagnostic.location.pageIndex + 1} 页`
                  : activeDiagnostic.location.startByte !== undefined &&
                      activeDiagnostic.location.endByte !== undefined
                    ? `源字节 ${activeDiagnostic.location.startByte}-${activeDiagnostic.location.endByte}`
                    : activeDiagnostic.code}
            </p>
          )}
          {etag && (
            <StructureEditor
              ref={editorRef}
              bookId={draft.book_id}
              etag={etag}
              focusedBlockId={focusedBlockId}
              headings={preview?.headings ?? []}
              onSaved={async () => {
                await refresh();
              }}
              onStateChange={updateEditorState}
              regions={draft.regions}
              revision={draft.config_revision}
              saveDisabled={draft.preview_state === "building"}
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
              onActivate={activateDiagnostic}
              onRecover={recoverDiagnostic}
              pageForBlock={pageForBlock}
              recoveryDisabled={
                editorState.dirty || editorState.conflict || editorState.saving
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
            {preview && preview.pages.length > 0 && (
              <label className="m-0">
                <span className="sr-only">预览页面</span>
                <select
                  className={`${manageField} w-auto`}
                  value={pageId ?? ""}
                  onChange={(event) => {
                    setFrameReady(false);
                    setSelectedFragment(null);
                    setSelectedPage(Number(event.target.value));
                    setNavigationSerial((value) => value + 1);
                  }}
                >
                  {preview.pages.map((page) => (
                    <option key={page.page_id} value={page.page_id}>
                      {page.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
              onActivate={activateDiagnostic}
              onRecover={recoverDiagnostic}
              pageForBlock={pageForBlock}
              recoveryDisabled={
                editorState.dirty || editorState.conflict || editorState.saving
              }
            />
          </div>
        </dialog>
      )}
    </div>
  );
}
