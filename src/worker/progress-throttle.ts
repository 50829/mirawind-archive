export function shouldReportJobProgress(input: {
  readonly lastPhase: string | null;
  readonly lastReportedAtMs: number;
  readonly nowMs: number;
  readonly phase: string;
}): boolean {
  return (
    input.phase !== input.lastPhase ||
    input.nowMs - input.lastReportedAtMs >= 250
  );
}
