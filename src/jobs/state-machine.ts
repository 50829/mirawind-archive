export const jobStates = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
] as const;

export type JobState = (typeof jobStates)[number];
export type TerminalJobState = Extract<
  JobState,
  "succeeded" | "failed" | "canceled" | "interrupted"
>;

const transitions: Readonly<Record<JobState, readonly JobState[]>> = {
  canceled: [],
  failed: [],
  interrupted: [],
  queued: ["running", "canceled"],
  running: ["succeeded", "failed", "canceled", "interrupted"],
  succeeded: [],
};

export function canTransitionJob(current: JobState, next: JobState): boolean {
  return transitions[current].includes(next);
}

export function assertJobTransition(current: JobState, next: JobState): void {
  if (!canTransitionJob(current, next)) {
    throw new Error(`JOB_TRANSITION_FORBIDDEN:${current}:${next}`);
  }
}

export function isTerminalJobState(state: JobState): state is TerminalJobState {
  return transitions[state].length === 0;
}
