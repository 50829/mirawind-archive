import type { PublishPolicy } from "../publish-policy";

export interface CandidatePublicationCapture {
  readonly bookId: number;
  readonly configRevision: number;
  readonly sourceId: string;
  readonly versionId: string;
}

export interface PublishedCandidate {
  readonly publishedAtMs: number;
  readonly state: "published";
  readonly versionId: string;
}

export interface CandidatePublicationPort {
  capture(input: {
    readonly bookId: number;
    readonly expectedConfigEtag: string;
  }): CandidatePublicationCapture;
  promote(input: {
    readonly actorUserId: string | null;
    readonly bookId: number;
    readonly expectedConfigRevision: number;
    readonly expectedVersionId: string;
    readonly nowMs: number;
  }): PublishedCandidate;
}

export async function publishCandidate(input: {
  readonly actorUserId: string | null;
  readonly bookId: number;
  readonly expectedConfigEtag: string;
  readonly nowMs: number;
  readonly policy: PublishPolicy;
  readonly publication: CandidatePublicationPort;
}): Promise<PublishedCandidate> {
  const capture = input.publication.capture({
    bookId: input.bookId,
    expectedConfigEtag: input.expectedConfigEtag,
  });
  const decision = await input.policy.evaluate({
    bookId: capture.bookId,
    configRevision: capture.configRevision,
    sourceId: capture.sourceId,
  });
  if (!decision.allowed) {
    const error = new Error(decision.code);
    error.name = "PublishPolicyError";
    throw error;
  }
  return input.publication.promote({
    actorUserId: input.actorUserId,
    bookId: input.bookId,
    expectedConfigRevision: capture.configRevision,
    expectedVersionId: capture.versionId,
    nowMs: input.nowMs,
  });
}
