import {
  canonicalJson,
  parseReaderManifestProjection,
  publishingReaderRendererAssets,
  validateBookDocument,
} from "./publication-formats";
import {
  assertJobProgressUpdate,
  isJobPhase,
  isKnownJobPhase,
  isJobProgress,
  jobKinds,
  userJobKinds,
} from "./job-state";
import { evaluateJobRetry } from "./retry-policy";
import {
  importUploadIdempotencyOperation,
  m1ImportExpiryMs,
  maximumUploadBytes,
} from "./import-upload-policy";
import { maximumCoverUploadBytes } from "./cover-upload-policy";
import { m1PublishPolicy } from "./publish-policy";
import {
  candidateBuildIdentities,
  candidateBuildPhases,
  parseBuildCandidateCommand,
  parseCandidateBuildArtifact,
} from "./commands/build-candidate";
import { finalizeCandidate } from "./commands/finalize-candidate";
import { publishCandidate } from "./commands/publish-candidate";
import { deriveBookVersionPresentation } from "./derive-book-version-presentation";
import {
  currentDraftCandidateStates,
  getCurrentDraftCandidate,
} from "./queries/get-draft";

export type {
  HeadingNumberingMode,
  TypographyProfile,
} from "./publication-formats";
export type {
  ReaderManifestPageProjection,
  ReaderManifestProjection,
  ReaderManifestResourceProjection,
} from "./publication-formats";
export type {
  JobProgress,
  JobProgressUnit,
  JobKind,
  JobPhase,
  UserJobKind,
  TerminalJobState,
  QueueObservation,
} from "./job-state";
export type {
  BuildCandidateCommand,
  CandidateBuildPhase,
  CandidateBuildStageUpdate,
  CandidateBuildArtifact,
} from "./commands/build-candidate";
export type { CandidateRegistrationPort } from "./commands/finalize-candidate";
export type {
  CandidatePublicationCapture,
  CandidatePublicationPort,
  PublishedCandidate,
} from "./commands/publish-candidate";
export type {
  CurrentDraftCandidateProjection,
  CurrentDraftCandidateRecord,
  CurrentDraftCandidateState,
} from "./queries/get-draft";

export {
  candidateBuildIdentities,
  candidateBuildPhases,
  currentDraftCandidateStates,
  deriveBookVersionPresentation,
  evaluateJobRetry,
  finalizeCandidate,
  getCurrentDraftCandidate,
  importUploadIdempotencyOperation,
  assertJobProgressUpdate,
  isJobPhase,
  isJobProgress,
  isKnownJobPhase,
  jobKinds,
  userJobKinds,
  m1ImportExpiryMs,
  m1PublishPolicy,
  maximumCoverUploadBytes,
  maximumUploadBytes,
  parseBuildCandidateCommand,
  parseCandidateBuildArtifact,
  publishCandidate,
  canonicalJson,
  parseReaderManifestProjection,
  publishingReaderRendererAssets,
  validateBookDocument,
};
