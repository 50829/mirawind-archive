import { isOpaqueId } from "@/domain/ids";

export const candidateBuildIdentities = Object.freeze({
  compiler: "compiler-v7",
  preview: "draft-preview-v7",
  reader: "mirawind-reader-v4-tailwind-4.3.3",
  renderer: "semantic-html-v7-katex-0.18.1",
} as const);
export const candidateBuildPhases = Object.freeze([
  "compile_book",
  "render_pages",
  "build_search",
  "finalize_candidate",
] as const);
export type CandidateBuildPhase = (typeof candidateBuildPhases)[number];
export interface CandidateBuildStageUpdate {
  readonly completed: number;
  readonly phase: CandidateBuildPhase;
  readonly total: number | null;
  readonly unit: "items" | "pages" | "steps";
}
export interface BuildCandidateCommand {
  readonly bookId: number;
  readonly candidateId: string;
  readonly capturedCurrentVersionId: string | null;
  readonly compilerIdentity: typeof candidateBuildIdentities.compiler;
  readonly inputRelativePath: string;
  readonly documentSha256: string;
  readonly sourceUpdatedAt: number;
  readonly jobId: string;
  readonly kind: "build_candidate";
  readonly previewIdentity: typeof candidateBuildIdentities.preview;
  readonly readerIdentity: typeof candidateBuildIdentities.reader;
  readonly rendererIdentity: typeof candidateBuildIdentities.renderer;
  readonly importId: string;
  readonly resourceRootRelativePath: string;
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
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("CANDIDATE_PROTOCOL_INVALID");
  return value as Record<string, unknown>;
}
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function count(value: unknown, maximum = 1_000_000): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}
export function parseBuildCandidateCommand(
  value: unknown,
): BuildCandidateCommand {
  const input = record(value);
  const keys = [
    "bookId",
    "candidateId",
    "capturedCurrentVersionId",
    "compilerIdentity",
    "documentSha256",
    "inputRelativePath",
    "sourceUpdatedAt",
    "jobId",
    "kind",
    "previewIdentity",
    "readerIdentity",
    "rendererIdentity",
    "importId",
    "resourceRootRelativePath",
    "versionId",
  ];
  if (
    !exactKeys(input, keys) ||
    input.kind !== "build_candidate" ||
    !count(input.bookId, Number.MAX_SAFE_INTEGER) ||
    Number(input.bookId) < 1 ||
    !count(input.sourceUpdatedAt, 8_640_000_000_000_000) ||
    typeof input.documentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.documentSha256) ||
    !isOpaqueId("draftCandidate", String(input.candidateId)) ||
    !isOpaqueId("job", String(input.jobId)) ||
    !isOpaqueId("import", String(input.importId)) ||
    !isOpaqueId("version", String(input.versionId)) ||
    (input.capturedCurrentVersionId !== null &&
      !isOpaqueId("version", String(input.capturedCurrentVersionId))) ||
    input.compilerIdentity !== candidateBuildIdentities.compiler ||
    input.rendererIdentity !== candidateBuildIdentities.renderer ||
    input.previewIdentity !== candidateBuildIdentities.preview ||
    input.readerIdentity !== candidateBuildIdentities.reader ||
    input.resourceRootRelativePath !== "books/" + input.bookId ||
    input.inputRelativePath !==
      "books/" +
        input.bookId +
        "/draft/candidates/" +
        input.candidateId +
        "/book.json"
  ) {
    throw new TypeError("BUILD_CANDIDATE_COMMAND_INVALID");
  }
  return Object.freeze(value as BuildCandidateCommand);
}
export function parseCandidateBuildArtifact(
  value: unknown,
  command: BuildCandidateCommand,
): CandidateBuildArtifact {
  const input = record(value);
  const keys = [
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
  ];
  if (
    !exactKeys(input, keys) ||
    input.kind !== "candidate_build_artifact" ||
    input.candidateId !== command.candidateId ||
    input.versionId !== command.versionId ||
    input.compilerIdentity !== command.compilerIdentity ||
    input.rendererIdentity !== command.rendererIdentity ||
    input.previewIdentity !== command.previewIdentity ||
    input.readerIdentity !== command.readerIdentity ||
    input.artifactRootRelativePath !==
      "books/" + command.bookId + "/versions/" + command.versionId ||
    ![
      "blockingDiagnosticCount",
      "diagnosticCount",
      "pageCount",
      "resourceCount",
      "searchRowCount",
    ].every((key) => count(input[key])) ||
    Number(input.pageCount) < 1 ||
    Number(input.pageCount) > 20000 ||
    Number(input.resourceCount) > 20000 ||
    Number(input.diagnosticCount) > 10000 ||
    Number(input.blockingDiagnosticCount) > Number(input.diagnosticCount) ||
    !["manifestSha256", "semanticDigest", "versionMarkerSha256"].every(
      (key) =>
        typeof input[key] === "string" && /^[a-f0-9]{64}$/u.test(input[key]),
    )
  ) {
    throw new TypeError("CANDIDATE_BUILD_ARTIFACT_INVALID");
  }
  return Object.freeze(value as CandidateBuildArtifact);
}
