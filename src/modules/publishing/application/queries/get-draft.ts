export const currentDraftCandidateStates = Object.freeze([
  "building",
  "ready",
  "failed",
  "canceled",
  "interrupted",
] as const);

export type CurrentDraftCandidateState =
  (typeof currentDraftCandidateStates)[number];

export interface CurrentDraftCandidateRecord {
  readonly attemptId: string;
  readonly configRevision: number;
  readonly previewUrl: string | null;
  readonly safeErrorCode: string | null;
  readonly semanticDigest: string | null;
  readonly state: CurrentDraftCandidateState;
  readonly versionId: string | null;
}

export interface CurrentDraftCandidateProjection {
  readonly attempt_id: string;
  readonly preview_url: string | null;
  readonly revision: number;
  readonly safe_error_code: string | null;
  readonly semantic_digest: string | null;
  readonly state: CurrentDraftCandidateState;
  readonly version_id: string | null;
}

function isSafeErrorCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,79}$/u.test(value);
}

function isPreviewUrl(
  value: string,
  bookId: number,
  revision: number,
): boolean {
  return new RegExp(
    `^/api/manage/books/${bookId}/preview/${revision}/pages/[1-9][0-9]*$`,
    "u",
  ).test(value);
}

export function getCurrentDraftCandidate(input: {
  readonly bookId: number;
  readonly candidate: CurrentDraftCandidateRecord | null;
  readonly configRevision: number;
}): CurrentDraftCandidateProjection | null {
  if (
    !Number.isSafeInteger(input.bookId) ||
    input.bookId < 1 ||
    !Number.isSafeInteger(input.configRevision) ||
    input.configRevision < 1
  ) {
    throw new TypeError("DRAFT_CANDIDATE_QUERY_INVALID");
  }
  const candidate = input.candidate;
  if (candidate === null) return null;
  if (
    candidate.configRevision !== input.configRevision ||
    !currentDraftCandidateStates.includes(candidate.state) ||
    (candidate.safeErrorCode !== null &&
      !isSafeErrorCode(candidate.safeErrorCode))
  ) {
    throw new TypeError("DRAFT_CANDIDATE_PROJECTION_INVALID");
  }

  const isReady = candidate.state === "ready";
  const hasReadyFields =
    candidate.versionId !== null &&
    candidate.semanticDigest !== null &&
    /^[a-f0-9]{64}$/u.test(candidate.semanticDigest) &&
    candidate.previewUrl !== null &&
    isPreviewUrl(candidate.previewUrl, input.bookId, input.configRevision);
  const hasNoReadyFields =
    candidate.versionId === null &&
    candidate.semanticDigest === null &&
    candidate.previewUrl === null;
  if (
    (isReady && (!hasReadyFields || candidate.safeErrorCode !== null)) ||
    (!isReady && !hasNoReadyFields) ||
    (candidate.state === "building" && candidate.safeErrorCode !== null)
  ) {
    throw new TypeError("DRAFT_CANDIDATE_PROJECTION_INVALID");
  }

  return Object.freeze({
    attempt_id: candidate.attemptId,
    preview_url: candidate.previewUrl,
    revision: candidate.configRevision,
    safe_error_code: candidate.safeErrorCode,
    semantic_digest: candidate.semanticDigest,
    state: candidate.state,
    version_id: candidate.versionId,
  });
}
