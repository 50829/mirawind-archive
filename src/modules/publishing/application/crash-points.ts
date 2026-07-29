export const publicationCrashPoints = [
  "before_fsync",
  "after_fsync_before_rename",
  "after_rename",
  "before_ready_search",
  "after_ready_search",
  "before_current_pointer",
  "after_current_pointer",
] as const;

export type PublicationCrashPoint = (typeof publicationCrashPoints)[number];

export type CrashPointInjector = (
  point: PublicationCrashPoint,
) => Promise<void> | void;

export async function injectCrashPoint(
  injector: CrashPointInjector | undefined,
  point: PublicationCrashPoint,
): Promise<void> {
  await injector?.(point);
}
