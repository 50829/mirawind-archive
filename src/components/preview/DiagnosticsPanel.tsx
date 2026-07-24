export function DiagnosticsPanel(props: {
  readonly diagnostics: readonly string[];
}) {
  return (
    <section className="diagnostics-panel" aria-labelledby="diagnostics-title">
      <h2 id="diagnostics-title">诊断</h2>
      {props.diagnostics.length === 0 ? (
        <p className="quiet">当前预览没有诊断信息。</p>
      ) : (
        <ul>
          {props.diagnostics.map((diagnostic, index) => (
            <li key={`${index}:${diagnostic}`}>{diagnostic}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
