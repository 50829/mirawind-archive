export interface CandidateView {
  readonly candidate_id: string;
  readonly confidence: "ambiguous" | "high";
  readonly diagnostics: readonly string[];
  readonly display_path: string;
  readonly evidence: readonly string[];
}

export function CandidateReview(props: {
  readonly candidates: readonly CandidateView[];
}) {
  if (props.candidates.length === 0) return null;
  return (
    <section aria-labelledby="candidate-title" className="mt-6">
      <h2 className="text-base font-bold" id="candidate-title">
        正文文件
      </h2>
      <div className="candidate-list mt-3 grid gap-3">
        {props.candidates.map((candidate) => (
          <article
            className={`candidate ${managePanel}`}
            key={candidate.candidate_id}
          >
            <h3 className="font-semibold [overflow-wrap:anywhere]">
              {candidate.display_path}
            </h3>
            {candidate.evidence.length > 0 && (
              <details className="mt-2 text-sm text-stone-600">
                <summary className="cursor-pointer">技术详情</summary>
                <ul>
                  {candidate.evidence.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            )}
            {candidate.diagnostics.map((item) => (
              <p className="diagnostic text-red-800" key={item}>
                {item}
              </p>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}
import { managePanel } from "../ui/manage-classes";
