interface PreviewDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly severity?: "error" | "info" | "warning";
}

export function DiagnosticsPanel(props: {
  readonly diagnostics: readonly PreviewDiagnostic[];
}) {
  return (
    <section className="diagnostics-panel" aria-labelledby="diagnostics-title">
      <h2 id="diagnostics-title">诊断</h2>
      {props.diagnostics.length === 0 ? (
        <p className="quiet">当前预览没有诊断信息。</p>
      ) : (
        <ul>
          {props.diagnostics.map((diagnostic, index) => (
            <li key={`${index}:${diagnostic.code}`}>
              <strong>{diagnostic.code}</strong>
              {diagnostic.severity ? ` · ${diagnostic.severity}` : ""}
              {diagnostic.path ? ` · ${diagnostic.path}` : ""}
              <br />
              {diagnostic.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
