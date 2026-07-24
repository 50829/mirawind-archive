export interface CandidateView {
  readonly candidate_id: string;
  readonly confidence: "ambiguous" | "generic" | "high";
  readonly diagnostics: readonly string[];
  readonly display_path: string;
  readonly evidence: readonly string[];
}

export function CandidateReview(props: {
  readonly candidates: readonly CandidateView[];
  readonly confirmable: boolean;
  readonly disabled: boolean;
  readonly onConfirm: (candidateId: string) => void;
}) {
  if (props.candidates.length === 0) return null;
  return (
    <section aria-labelledby="candidate-title">
      <h2 id="candidate-title">主 Markdown 候选</h2>
      <div className="candidate-list">
        {props.candidates.map((candidate) => (
          <article className="candidate" key={candidate.candidate_id}>
            <h3>{candidate.display_path}</h3>
            <p>置信度：{candidate.confidence}</p>
            {candidate.evidence.length > 0 && (
              <ul>
                {candidate.evidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {candidate.diagnostics.map((item) => (
              <p className="diagnostic" key={item}>
                {item}
              </p>
            ))}
            {props.confirmable && candidate.confidence === "generic" && (
              <button
                disabled={props.disabled}
                onClick={() => props.onConfirm(candidate.candidate_id)}
                type="button"
              >
                确认使用此文件
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
