export const jobKinds = [
  "analyze_import",
  "prepare_draft",
  "build_candidate",
  "verify_version",
  "reconcile",
  "reclaim_versions",
  "purge_book",
] as const;

export type JobKind = (typeof jobKinds)[number];
export type JobState =
  "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
export type TerminalJobState = Extract<
  JobState,
  "succeeded" | "failed" | "canceled" | "interrupted"
>;

const terminalPhases = [
  "complete",
  "failed",
  "canceled",
  "interrupted",
] as const;

const jobPhases = Object.freeze({
  analyze_import: [
    "queued",
    "starting",
    "security_check",
    "identify_document",
    ...terminalPhases,
  ],
  prepare_draft: [
    "queued",
    "starting",
    "security_check",
    "identify_document",
    "organize_structure",
    ...terminalPhases,
  ],
  build_candidate: [
    "queued",
    "starting",
    "compile_book",
    "render_pages",
    "build_search",
    "finalize_candidate",
    ...terminalPhases,
  ],
  verify_version: ["queued", "starting", "verify_manifest", ...terminalPhases],
  reconcile: ["queued", "starting", "reconcile_storage", ...terminalPhases],
  reclaim_versions: [
    "queued",
    "starting",
    "reclaim_storage",
    ...terminalPhases,
  ],
  purge_book: [
    "queued",
    "starting",
    "permanent_book_deletion",
    ...terminalPhases,
  ],
} satisfies Readonly<Record<JobKind, readonly string[]>>);

export type JobPhase = (typeof jobPhases)[JobKind][number];

const knownJobPhases = new Set<string>(Object.values(jobPhases).flat());

export function isKnownJobPhase(phase: string): phase is JobPhase {
  return knownJobPhases.has(phase);
}

export function isJobPhase(kind: JobKind, phase: string): phase is JobPhase {
  return jobPhases[kind].includes(phase as never);
}

export function assertJobPhase(kind: JobKind, phase: string): void {
  if (!isJobPhase(kind, phase)) {
    throw new Error(`JOB_PHASE_INVALID:${kind}:${phase}`);
  }
}

const transitions: Readonly<Record<JobState, readonly JobState[]>> = {
  canceled: [],
  failed: [],
  interrupted: [],
  queued: ["running", "canceled"],
  running: ["succeeded", "failed", "canceled", "interrupted"],
  succeeded: [],
};

function canTransitionJob(current: JobState, next: JobState): boolean {
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
