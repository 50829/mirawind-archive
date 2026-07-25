export const bookDeletionStates = [
  "pending",
  "purging",
  "failed",
  "completed",
] as const;

export type BookDeletionState = (typeof bookDeletionStates)[number];

export const deletionSafeErrorCodes = [
  "CLEANUP_DATABASE_CONFLICT",
  "CLEANUP_DATABASE_INTEGRITY",
  "CLEANUP_FILESYSTEM_IO",
  "CLEANUP_FILESYSTEM_PERMISSION",
  "CLEANUP_INTERRUPTED",
  "CLEANUP_INVALID_STATE",
  "CLEANUP_TARGET_OUTSIDE_ROOT",
  "CLEANUP_TIMEOUT",
  "CLEANUP_UNSAFE_TARGET",
] as const;

export type DeletionSafeErrorCode = (typeof deletionSafeErrorCodes)[number];

export function isDeletionSafeErrorCode(
  value: string,
): value is DeletionSafeErrorCode {
  return deletionSafeErrorCodes.includes(value as DeletionSafeErrorCode);
}
