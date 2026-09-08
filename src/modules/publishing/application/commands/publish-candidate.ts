import type { PublishPolicy } from "../publish-policy";

export interface CandidatePublicationCapture {
  readonly bookId: number;
  readonly sourceUpdatedAt: number;
  readonly importId: string;
  readonly versionId: string;
  readonly candidateId: string;
}
export interface PublishedCandidate {
  readonly publishedAtMs: number;
  readonly state: "published";
  readonly versionId: string;
}
export interface CandidatePublicationPort {
  capture(input: {
    readonly bookId: number;
    readonly expectedUpdatedAt: number;
    readonly candidateId: string;
  }): CandidatePublicationCapture;
  promote(input: {
    readonly actorUserId: string | null;
    readonly bookId: number;
    readonly expectedUpdatedAt: number;
    readonly expectedVersionId: string;
    readonly candidateId: string;
    readonly nowMs: number;
  }): PublishedCandidate;
}
export async function publishCandidate(input: {
  readonly actorUserId: string | null;
  readonly bookId: number;
  readonly expectedUpdatedAt: number;
  readonly candidateId: string;
  readonly nowMs: number;
  readonly policy: PublishPolicy;
  readonly publication: CandidatePublicationPort;
}): Promise<PublishedCandidate> {
  const capture = input.publication.capture({
    bookId: input.bookId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    candidateId: input.candidateId,
  });
  const decision = await input.policy.evaluate({
    bookId: capture.bookId,
    sourceUpdatedAt: capture.sourceUpdatedAt,
    importId: capture.importId,
  });
  if (!decision.allowed) {
    const error = new Error(decision.code);
    error.name = "PublishPolicyError";
    throw error;
  }
  return input.publication.promote({
    actorUserId: input.actorUserId,
    bookId: input.bookId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    expectedVersionId: capture.versionId,
    candidateId: input.candidateId,
    nowMs: input.nowMs,
  });
}
