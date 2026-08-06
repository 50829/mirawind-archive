import {
  canonicalJson,
  katexCriticalCss,
  parseBookConfigYaml,
  publishingRendererIdentity,
  rendererStylesheetUrl,
  validateBookConfig,
  validateDocumentManifest,
} from "@/modules/publishing/application/publication-formats";
import {
  isKnownJobPhase,
  jobKinds,
} from "@/modules/publishing/application/job-state";
import { evaluateJobRetry } from "@/modules/publishing/application/retry-policy";
import {
  importUploadIdempotencyOperation,
  m1ImportExpiryMs,
  maximumUploadBytes,
} from "@/modules/publishing/application/import-upload-policy";
import { maximumCoverUploadBytes } from "@/modules/publishing/application/cover-upload-policy";
import { m1PublishPolicy } from "@/modules/publishing/application/publish-policy";
import {
  candidateBuildIdentities,
  candidateBuildPhases,
  parseBuildCandidateCommand,
  parseCandidateBuildArtifact,
} from "@/modules/publishing/application/commands/build-candidate";
import { finalizeCandidate } from "@/modules/publishing/application/commands/finalize-candidate";
import { publishCandidate } from "@/modules/publishing/application/commands/publish-candidate";
import {
  currentDraftCandidateStates,
  getCurrentDraftCandidate,
} from "@/modules/publishing/application/queries/get-draft";

export type {
  BookVersionRecord,
  BookVersionState,
  HeadingNumberingMode,
  TypographyProfile,
} from "@/modules/publishing/application/publication-formats";
export type {
  JobKind,
  JobPhase,
} from "@/modules/publishing/application/job-state";
export type {
  BuildCandidateCommand,
  CandidateBuildPhase,
  CandidateBuildStageUpdate,
  CandidateBuildArtifact,
} from "@/modules/publishing/application/commands/build-candidate";
export type { CandidateRegistrationPort } from "@/modules/publishing/application/commands/finalize-candidate";
export type {
  CandidatePublicationCapture,
  CandidatePublicationPort,
  PublishedCandidate,
} from "@/modules/publishing/application/commands/publish-candidate";
export type {
  CurrentDraftCandidateProjection,
  CurrentDraftCandidateRecord,
  CurrentDraftCandidateState,
} from "@/modules/publishing/application/queries/get-draft";

export {
  candidateBuildIdentities,
  candidateBuildPhases,
  currentDraftCandidateStates,
  evaluateJobRetry,
  finalizeCandidate,
  getCurrentDraftCandidate,
  importUploadIdempotencyOperation,
  isKnownJobPhase,
  jobKinds,
  m1ImportExpiryMs,
  m1PublishPolicy,
  maximumCoverUploadBytes,
  maximumUploadBytes,
  parseBuildCandidateCommand,
  parseCandidateBuildArtifact,
  publishingRendererIdentity,
  publishCandidate,
  canonicalJson,
  katexCriticalCss,
  parseBookConfigYaml,
  rendererStylesheetUrl,
  validateBookConfig,
  validateDocumentManifest,
};
