import { useMemo, useState } from "react";

import {
  manageField,
  manageFieldLabel,
  manageQuietButton,
  manageQuietText,
} from "@/components/ui/manage-classes";

interface PreviewDiagnostic {
  readonly blockId?: string;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly severity?: "error" | "info" | "warning";
}

export function DiagnosticsPanel(props: {
  readonly diagnostics: readonly PreviewDiagnostic[];
  readonly onActivate?: (diagnostic: PreviewDiagnostic) => void;
  readonly pageForBlock?: (blockId: string) => number | null;
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
              diagnostic.blockId && pageForBlock
                ? pageForBlock(diagnostic.blockId)
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
      diagnostic.blockId && pageForBlock?.(diagnostic.blockId) === pageId,
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
                <br />
                {diagnostic.message}
                {diagnostic.blockId && props.onActivate ? (
                  <button
                    className={`${manageQuietButton} mt-2`}
                    onClick={() => props.onActivate?.(diagnostic)}
                    type="button"
                  >
                    定位
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
