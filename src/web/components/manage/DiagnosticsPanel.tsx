import { LocateFixed, RefreshCw, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import {
  manageField,
  manageFieldLabel,
  manageQuietButton,
  manageQuietText,
} from "@/web/components/ui/manage-classes";

export interface PreviewDiagnostic {
  readonly blockId?: string;
  readonly code: string;
  readonly confidence?: "high" | "low" | "medium";
  readonly evidence?: readonly string[];
  readonly location?: {
    readonly blockId?: string;
    readonly endByte?: number;
    readonly pageIndex?: number;
    readonly regionId?: string;
    readonly startByte?: number;
  };
  readonly message: string;
  readonly path?: string;
  readonly phase?:
    | "contents"
    | "matching"
    | "ocr"
    | "selection"
    | "splitting"
    | "structure"
    | "typography";
  readonly recovery?: readonly (
    "reload" | "reprocess_verbatim" | "select_structure"
  )[];
  readonly severity?: "error" | "info" | "warning";
}

const recoveryLabels = {
  reload: "重新载入",
  reprocess_verbatim: "按原文重新处理",
  select_structure: "定位结构",
} as const;

export function DiagnosticsPanel(props: {
  readonly diagnostics: readonly PreviewDiagnostic[];
  readonly onActivate?: (diagnostic: PreviewDiagnostic) => void;
  readonly onRecover?: (
    action: NonNullable<PreviewDiagnostic["recovery"]>[number],
    diagnostic: PreviewDiagnostic,
  ) => void;
  readonly pageForBlock?: (blockId: string) => number | null;
  readonly recoveryDisabled?: boolean;
}) {
  const diagnostics = props.diagnostics;
  const pageForBlock = props.pageForBlock;
  const [severity, setSeverity] = useState<
    "all" | "error" | "info" | "warning"
  >("all");
  const [pageId, setPageId] = useState<"all" | number>("all");
  const pageIds = useMemo(
    () =>
      [
        ...new Set(
          diagnostics.flatMap((diagnostic) => {
            const page =
              (diagnostic.location?.blockId ?? diagnostic.blockId) &&
              pageForBlock
                ? pageForBlock(
                    diagnostic.location?.blockId ?? diagnostic.blockId ?? "",
                  )
                : null;
            return page === null ? [] : [page];
          }),
        ),
      ].sort((left, right) => left - right),
    [diagnostics, pageForBlock],
  );
  const filtered = diagnostics.filter((diagnostic) => {
    const diagnosticSeverity = diagnostic.severity ?? "warning";
    if (severity !== "all" && severity !== diagnosticSeverity) return false;
    if (pageId === "all") return true;
    return Boolean(
      (diagnostic.location?.blockId ?? diagnostic.blockId) &&
      pageForBlock?.(
        diagnostic.location?.blockId ?? diagnostic.blockId ?? "",
      ) === pageId,
    );
  });
  return (
    <section
      className="diagnostics-panel mt-6"
      aria-labelledby="diagnostics-title"
    >
      <h2 className="text-base font-bold" id="diagnostics-title">
        诊断
      </h2>
      {diagnostics.length === 0 ? (
        <p className={`quiet ${manageQuietText}`}>当前预览没有诊断信息。</p>
      ) : (
        <>
          <div className="diagnostic-filters grid grid-cols-2 gap-3">
            <label className={manageFieldLabel}>
              严重度
              <select
                className={manageField}
                onChange={(event) =>
                  setSeverity(event.currentTarget.value as typeof severity)
                }
                value={severity}
              >
                <option value="all">全部</option>
                <option value="error">错误</option>
                <option value="warning">警告</option>
                <option value="info">信息</option>
              </select>
            </label>
            <label className={manageFieldLabel}>
              页面
              <select
                className={manageField}
                onChange={(event) =>
                  setPageId(
                    event.currentTarget.value === "all"
                      ? "all"
                      : Number(event.currentTarget.value),
                  )
                }
                value={pageId}
              >
                <option value="all">全部</option>
                {pageIds.map((page) => (
                  <option key={page} value={page}>
                    {page}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="grid gap-3 p-0">
            {filtered.map((diagnostic, index) => (
              <li
                className={`list-none border-l-4 p-3 text-sm ${
                  diagnostic.severity === "error"
                    ? "border-red-600 bg-red-50 text-red-900"
                    : diagnostic.severity === "info"
                      ? "border-stone-400 bg-stone-50 text-stone-800"
                      : "border-amber-500 bg-amber-50 text-amber-900"
                }`}
                key={`${index}:${diagnostic.code}`}
              >
                <strong>{diagnostic.code}</strong>
                {diagnostic.severity ? ` · ${diagnostic.severity}` : ""}
                {diagnostic.path ? ` · ${diagnostic.path}` : ""}
                {diagnostic.phase ? ` · ${diagnostic.phase}` : ""}
                {diagnostic.confidence
                  ? ` · 置信度 ${diagnostic.confidence}`
                  : ""}
                {diagnostic.location?.startByte !== undefined &&
                diagnostic.location.endByte !== undefined
                  ? ` · 源字节 ${diagnostic.location.startByte}-${diagnostic.location.endByte}`
                  : ""}
                {diagnostic.location?.pageIndex !== undefined
                  ? ` · 原 PDF 第 ${diagnostic.location.pageIndex + 1} 页`
                  : ""}
                {diagnostic.location?.regionId
                  ? ` · 区域 ${diagnostic.location.regionId}`
                  : ""}
                <br />
                {diagnostic.message}
                {diagnostic.evidence?.length ? (
                  <p className="my-2 text-xs">
                    依据：{diagnostic.evidence.join("；")}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {(diagnostic.location || diagnostic.blockId) &&
                  props.onActivate ? (
                    <button
                      className={manageQuietButton}
                      onClick={() => props.onActivate?.(diagnostic)}
                      type="button"
                    >
                      <LocateFixed aria-hidden="true" size={16} />
                      定位
                    </button>
                  ) : null}
                  {props.onRecover
                    ? diagnostic.recovery
                        ?.filter((action) => action !== "select_structure")
                        .map((action) => (
                          <button
                            className={manageQuietButton}
                            disabled={
                              props.recoveryDisabled &&
                              action === "reprocess_verbatim"
                            }
                            key={action}
                            onClick={() =>
                              props.onRecover?.(action, diagnostic)
                            }
                            type="button"
                          >
                            {action === "reload" ? (
                              <RefreshCw aria-hidden="true" size={16} />
                            ) : (
                              <RotateCcw aria-hidden="true" size={16} />
                            )}
                            {recoveryLabels[action]}
                          </button>
                        ))
                    : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
