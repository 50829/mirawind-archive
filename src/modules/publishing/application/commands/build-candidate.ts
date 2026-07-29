import { isOpaqueId } from "@/domain/ids";

export const candidateBuildIdentities = Object.freeze({
  compiler: "compiler-v5",
  preview: "draft-preview-v5",
  reader: "mirawind-reader-v2-tailwind-4.3.3",
  renderer: "semantic-html-v5-katex-0.18.1",
} as const);

export interface BuildCandidateCommand {
  readonly bookId: number;
  readonly candidateId: string;
  readonly capturedCurrentVersionId: string | null;
  readonly compilerIdentity: typeof candidateBuildIdentities.compiler;
  readonly configRelativePath: string;
  readonly configRevision: number;
  readonly jobId: string;
  readonly kind: "build_candidate";
  readonly previewIdentity: typeof candidateBuildIdentities.preview;
  readonly readerIdentity: typeof candidateBuildIdentities.reader;
  readonly rendererIdentity: typeof candidateBuildIdentities.renderer;
  readonly sourceId: string;
  readonly sourceRootRelativePath: string;
  readonly versionId: string;
}

export interface CandidateBuildArtifact {
  readonly artifactRootRelativePath: string;
  readonly blockingDiagnosticCount: number;
  readonly candidateId: string;
  readonly compilerIdentity: typeof candidateBuildIdentities.compiler;
  readonly diagnosticCount: number;
  readonly kind: "candidate_build_artifact";
  readonly manifestSha256: string;
  readonly pageCount: number;
  readonly previewIdentity: typeof candidateBuildIdentities.preview;
  readonly readerIdentity: typeof candidateBuildIdentities.reader;
  readonly rendererIdentity: typeof candidateBuildIdentities.renderer;
  readonly resourceCount: number;
  readonly searchRowCount: number;
  readonly semanticDigest: string;
  readonly versionId: string;
  readonly versionMarkerSha256: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const orderedExpected = [...expected].sort();
  return (
    actual.length === orderedExpected.length &&
    actual.every((key, index) => key === orderedExpected[index])
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isBoundedCount(value: unknown, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

const commandKeys = [
  "bookId",
  "candidateId",
  "capturedCurrentVersionId",
  "compilerIdentity",
  "configRelativePath",
  "configRevision",
  "jobId",
  "kind",
  "previewIdentity",
  "readerIdentity",
  "rendererIdentity",
  "sourceId",
  "sourceRootRelativePath",
  "versionId",
] as const;

export function parseBuildCandidateCommand(
  value: unknown,
): BuildCandidateCommand {
  if (!isRecord(value) || !hasExactKeys(value, commandKeys)) {
    throw new TypeError("BUILD_CANDIDATE_COMMAND_INVALID");
  }
  const bookId = value.bookId;
  const configRevision = value.configRevision;
  const sourceId = value.sourceId;
  if (
    value.kind !== "build_candidate" ||
    !isPositiveInteger(bookId) ||
    !isPositiveInteger(configRevision) ||
    typeof value.jobId !== "string" ||
    !isOpaqueId("job", value.jobId) ||
    typeof value.candidateId !== "string" ||
    !isOpaqueId("candidate", value.candidateId) ||
    typeof sourceId !== "string" ||
    !isOpaqueId("source", sourceId) ||
    typeof value.versionId !== "string" ||
    !isOpaqueId("version", value.versionId) ||
    (value.capturedCurrentVersionId !== null &&
      (typeof value.capturedCurrentVersionId !== "string" ||
        !isOpaqueId("version", value.capturedCurrentVersionId))) ||
    value.compilerIdentity !== candidateBuildIdentities.compiler ||
    value.rendererIdentity !== candidateBuildIdentities.renderer ||
    value.previewIdentity !== candidateBuildIdentities.preview ||
    value.readerIdentity !== candidateBuildIdentities.reader ||
    value.sourceRootRelativePath !==
      `books/${bookId}/draft/source/${sourceId}` ||
    value.configRelativePath !==
      `books/${bookId}/draft/configs/${configRevision}/book.yaml`
  ) {
    throw new TypeError("BUILD_CANDIDATE_COMMAND_INVALID");
  }
  return Object.freeze(value as unknown as BuildCandidateCommand);
}

const artifactKeys = [
  "artifactRootRelativePath",
  "blockingDiagnosticCount",
  "candidateId",
  "compilerIdentity",
  "diagnosticCount",
  "kind",
  "manifestSha256",
  "pageCount",
  "previewIdentity",
  "readerIdentity",
  "rendererIdentity",
  "resourceCount",
  "searchRowCount",
  "semanticDigest",
  "versionId",
  "versionMarkerSha256",
] as const;

export function parseCandidateBuildArtifact(
  value: unknown,
  command: BuildCandidateCommand,
): CandidateBuildArtifact {
  if (!isRecord(value) || !hasExactKeys(value, artifactKeys)) {
    throw new TypeError("CANDIDATE_BUILD_ARTIFACT_INVALID");
  }
  if (
    value.kind !== "candidate_build_artifact" ||
    value.candidateId !== command.candidateId ||
    value.versionId !== command.versionId ||
    value.compilerIdentity !== command.compilerIdentity ||
    value.rendererIdentity !== command.rendererIdentity ||
    value.previewIdentity !== command.previewIdentity ||
    value.readerIdentity !== command.readerIdentity ||
    value.artifactRootRelativePath !==
      `books/${command.bookId}/versions/${command.versionId}` ||
    !isSha256(value.semanticDigest) ||
    !isSha256(value.manifestSha256) ||
    !isSha256(value.versionMarkerSha256) ||
    !isBoundedCount(value.pageCount, 1_000_000) ||
    value.pageCount < 1 ||
    !isBoundedCount(value.resourceCount, 20_000) ||
    !isBoundedCount(value.searchRowCount, 10_000_000) ||
    !isBoundedCount(value.diagnosticCount, 10_000) ||
    !isBoundedCount(value.blockingDiagnosticCount, 10_000) ||
    value.blockingDiagnosticCount > value.diagnosticCount
  ) {
    throw new TypeError("CANDIDATE_BUILD_ARTIFACT_INVALID");
  }
  return Object.freeze(value as unknown as CandidateBuildArtifact);
}
