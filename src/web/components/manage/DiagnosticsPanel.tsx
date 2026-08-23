import { FilePenLine, LocateFixed, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import type { DiagnosticTarget } from "@/domain/errors";
import {
  manageField,
  manageFieldLabel,
  manageQuietButton,
  manageQuietText,
} from "../ui/manage-classes";
import type { PreviewDiagnostic } from "../../contracts/publishing";

function targetPage(diagnostic: PreviewDiagnostic): number | null {
  const target = diagnostic.targets?.find(
    (
      candidate,
    ): candidate is Extract<
      DiagnosticTarget,
      { kind: "edit_block" | "select_structure" }
    > =>
      candidate.kind === "edit_block" || candidate.kind === "select_structure",
  );
  return target?.pageId ?? null;
}

export function DiagnosticsPanel(props: {
  readonly diagnostics: readonly PreviewDiagnostic[];
  readonly onTarget?: (
    target: DiagnosticTarget,
    diagnostic: PreviewDiagnostic,
  ) => void;
  readonly reprocessDisabled?: boolean;
}) {
  const diagnostics = props.diagnostics;
  const [severity, setSeverity] = useState<
    "all" | "error" | "info" | "warning"
  >("all");
  const [pageId, setPageId] = useState<"all" | number>("all");
  const pageIds = useMemo(
    () =>
      [
        ...new Set(
          diagnostics.flatMap((diagnostic) => {
            const page = targetPage(diagnostic);
            return page === null ? [] : [page];
          }),
        ),
      ].sort((left, right) => left - right),
    [diagnostics],
  );
  const filtered = diagnostics.filter((diagnostic) => {
    const diagnosticSeverity = diagnostic.severity ?? "warning";
    if (severity !== "all" && severity !== diagnosticSeverity) return false;
    if (pageId === "all") return true;
    return targetPage(diagnostic) === pageId;
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
                  {props.onTarget
                    ? diagnostic.targets?.map((target) => (
                        <button
                          className={manageQuietButton}
                          disabled={
                            props.reprocessDisabled &&
                            target.kind === "reprocess_verbatim"
                          }
                          key={`${target.kind}:${"blockId" in target ? target.blockId : "book"}`}
                          onClick={() => props.onTarget?.(target, diagnostic)}
                          type="button"
                        >
                          {target.kind === "select_structure" ? (
                            <LocateFixed aria-hidden="true" size={16} />
                          ) : target.kind === "edit_block" ? (
                            <FilePenLine aria-hidden="true" size={16} />
                          ) : (
                            <RotateCcw aria-hidden="true" size={16} />
                          )}
                          {target.kind === "select_structure"
                            ? "定位结构"
                            : target.kind === "edit_block"
                              ? "编辑正文"
                              : "按原文重新处理"}
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
