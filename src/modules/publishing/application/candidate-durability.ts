export const candidateTreeCrashPoints = [
  "before_fsync",
  "after_fsync_before_rename",
  "after_rename",
] as const;

export type CandidateTreeCrashPoint = (typeof candidateTreeCrashPoints)[number];

export type CandidateTreeCrashPointInjector = (
  point: CandidateTreeCrashPoint,
) => Promise<void> | void;

export async function injectCandidateTreeCrashPoint(
  injector: CandidateTreeCrashPointInjector | undefined,
  point: CandidateTreeCrashPoint,
): Promise<void> {
  await injector?.(point);
}
