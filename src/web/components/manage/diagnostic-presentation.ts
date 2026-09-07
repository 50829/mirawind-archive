import type { PreviewDiagnostic } from "../../contracts/publishing";

export function actionableDiagnostics(
  diagnostics: readonly PreviewDiagnostic[],
): readonly PreviewDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.phase !== "typography" &&
      !diagnostic.code.startsWith("TYPOGRAPHY_"),
  );
}

export function diagnosticSummary(diagnostics: readonly PreviewDiagnostic[]): {
  readonly errors: number;
  readonly information: number;
  readonly warnings: number;
} {
  const actionable = actionableDiagnostics(diagnostics);
  return Object.freeze({
    errors: actionable.filter((diagnostic) => diagnostic.severity === "error")
      .length,
    information: actionable.filter(
      (diagnostic) => diagnostic.severity === "info",
    ).length,
    warnings: actionable.filter(
      (diagnostic) =>
        diagnostic.severity === "warning" || diagnostic.severity === undefined,
    ).length,
  });
}
