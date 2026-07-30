import { isOpaqueId } from "@/domain/ids";
import {
  candidateBuildPhases,
  isKnownJobPhase,
  jobKinds,
  parseBuildCandidateCommand,
  parseCandidateBuildArtifact,
  type BuildCandidateCommand,
  type CandidateBuildPhase,
  type CandidateBuildArtifact,
  type JobKind,
  type JobPhase,
  type TypographyProfile,
} from "@/modules/publishing/application/public";

export const jobChildProtocolVersion = 3;
export const candidateJobChildProtocolVersion = jobChildProtocolVersion;

export interface BuildCandidateRunMessage {
  readonly input: BuildCandidateCommand;
  readonly protocolVersion: typeof candidateJobChildProtocolVersion;
  readonly type: "run";
}

export interface BuildCandidateProgressMessage {
  readonly jobId: string;
  readonly phase: CandidateBuildPhase;
  readonly progress: JobProgress;
  readonly protocolVersion: typeof candidateJobChildProtocolVersion;
  readonly type: "progress";
}

export interface BuildCandidateSuccessMessage {
  readonly jobId: string;
  readonly ok: true;
  readonly protocolVersion: typeof candidateJobChildProtocolVersion;
  readonly result: CandidateBuildArtifact;
  readonly type: "result";
}

export interface BuildCandidateFailureMessage {
  readonly jobId: string;
  readonly ok: false;
  readonly protocolVersion: typeof candidateJobChildProtocolVersion;
  readonly safeErrorClass: NonNullable<JobResultMessage["safeErrorClass"]>;
  readonly safeErrorCode: string;
  readonly type: "result";
}

export type BuildCandidateChildMessage =
  | BuildCandidateFailureMessage
  | BuildCandidateProgressMessage
  | BuildCandidateSuccessMessage;

interface FrozenJobCommandBase {
  readonly attempt: number;
  readonly createdAtMs: number;
  readonly jobId: string;
  readonly stagingRelativePath: string;
}

export interface AnalyzeImportCommand extends FrozenJobCommandBase {
  readonly importId: string;
  readonly importUploadRelativePath: string;
  readonly kind: "analyze_import";
}

export interface PrepareDraftCommand extends FrozenJobCommandBase {
  readonly bookId: number;
  readonly capturedConfigRevision: number | null;
  readonly capturedSourceId: string | null;
  readonly configYamlRelativePath: string | null;
  readonly importId: string;
  readonly importUploadRelativePath: string;
  readonly kind: "prepare_draft";
  readonly selectedCandidateRelativePath: string;
  readonly sourceRootRelativePath: string | null;
  readonly typographyProfile?: TypographyProfile | null;
}

export interface VerifyVersionCommand extends FrozenJobCommandBase {
  readonly kind: "verify_version";
  readonly versionId: string;
}

export interface ReconcileCommand extends FrozenJobCommandBase {
  readonly kind: "reconcile";
}

export interface ReclaimCommand extends FrozenJobCommandBase {
  readonly bookId: number | null;
  readonly kind: "reclaim";
}

export type FrozenJobInput =
  | AnalyzeImportCommand
  | BuildCandidateCommand
  | PrepareDraftCommand
  | ReclaimCommand
  | ReconcileCommand
  | VerifyVersionCommand;

export interface RunJobMessage {
  readonly input: FrozenJobInput;
  readonly protocolVersion: typeof jobChildProtocolVersion;
  readonly type: "run";
}

export interface CancelJobMessage {
  readonly jobId: string;
  readonly protocolVersion: typeof jobChildProtocolVersion;
  readonly type: "cancel";
}

export type ParentToChildMessage = CancelJobMessage | RunJobMessage;

export interface JobProgressMessage {
  readonly jobId: string;
  readonly phase: JobPhase;
  readonly progress: JobProgress;
  readonly protocolVersion: typeof jobChildProtocolVersion;
  readonly type: "progress";
}

export type JobProgressUnit = "bytes" | "items" | "pages" | "steps";

export interface JobProgress {
  readonly completed: number;
  readonly processed_bytes: number | null;
  readonly total: number | null;
  readonly unit: JobProgressUnit;
}

export interface JobResultMessage {
  readonly jobId: string;
  readonly ok: boolean;
  readonly protocolVersion: typeof jobChildProtocolVersion;
  readonly result?: Readonly<Record<string, string | number | boolean | null>>;
  readonly safeErrorClass?:
    | "infrastructure"
    | "content"
    | "validation"
    | "security_limit"
    | "timeout"
    | "canceled";
  readonly safeErrorCode?: string;
  readonly type: "result";
}

export type ChildToParentMessage = JobProgressMessage | JobResultMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isNullableTypographyProfile(
  value: unknown,
): value is TypographyProfile | null | undefined {
  return (
    value === undefined ||
    value === null ||
    value === "verbatim-v1" ||
    value === "zh-smart-v1"
  );
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 1)
  );
}

function isSafeScalarRecord(
  value: unknown,
): value is Record<string, string | number | boolean | null> {
  if (!isRecord(value) || Object.keys(value).length > 100) return false;
  return Object.entries(value).every(
    ([key, item]) =>
      key.length >= 1 &&
      key.length <= 80 &&
      (item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean") &&
      (typeof item !== "string" || item.length <= 500) &&
      (typeof item !== "number" || Number.isFinite(item)),
  );
}

export function isJobProgress(value: unknown): value is JobProgress {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).some(
      (key) => !["completed", "processed_bytes", "total", "unit"].includes(key),
    )
  ) {
    return false;
  }
  const completed = value.completed;
  const total = value.total;
  const processedBytes = value.processed_bytes;
  return (
    typeof completed === "number" &&
    Number.isSafeInteger(completed) &&
    completed >= 0 &&
    (total === null ||
      (typeof total === "number" &&
        Number.isSafeInteger(total) &&
        total >= completed)) &&
    (processedBytes === null ||
      (typeof processedBytes === "number" &&
        Number.isSafeInteger(processedBytes) &&
        processedBytes >= 0)) &&
    ["bytes", "items", "pages", "steps"].includes(String(value.unit))
  );
}

const candidateBuildPhaseSet = new Set<CandidateBuildPhase>(
  candidateBuildPhases,
);

const safeErrorClasses = new Set<
  NonNullable<JobResultMessage["safeErrorClass"]>
>([
  "infrastructure",
  "content",
  "validation",
  "security_limit",
  "timeout",
  "canceled",
]);

function isSafeErrorCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{2,79}$/u.test(value);
}

export function parseBuildCandidateRunMessage(
  value: unknown,
): BuildCandidateRunMessage {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["input", "protocolVersion", "type"]) ||
    value.type !== "run" ||
    value.protocolVersion !== candidateJobChildProtocolVersion
  ) {
    throw new TypeError("BUILD_CANDIDATE_RUN_MESSAGE_INVALID");
  }
  try {
    return Object.freeze({
      input: parseBuildCandidateCommand(value.input),
      protocolVersion: candidateJobChildProtocolVersion,
      type: "run",
    });
  } catch {
    throw new TypeError("BUILD_CANDIDATE_RUN_MESSAGE_INVALID");
  }
}

export function parseBuildCandidateChildMessage(
  value: unknown,
  command: BuildCandidateCommand,
): BuildCandidateChildMessage {
  if (
    !isRecord(value) ||
    value.protocolVersion !== candidateJobChildProtocolVersion ||
    value.jobId !== command.jobId
  ) {
    throw new TypeError("BUILD_CANDIDATE_CHILD_MESSAGE_INVALID");
  }
  if (value.type === "progress") {
    if (
      !exactKeys(value, [
        "jobId",
        "phase",
        "progress",
        "protocolVersion",
        "type",
      ]) ||
      typeof value.phase !== "string" ||
      !candidateBuildPhaseSet.has(value.phase as CandidateBuildPhase) ||
      !isJobProgress(value.progress)
    ) {
      throw new TypeError("BUILD_CANDIDATE_CHILD_MESSAGE_INVALID");
    }
    return Object.freeze(value as unknown as BuildCandidateProgressMessage);
  }
  if (value.type !== "result" || typeof value.ok !== "boolean") {
    throw new TypeError("BUILD_CANDIDATE_CHILD_MESSAGE_INVALID");
  }
  if (value.ok) {
    if (
      !exactKeys(value, ["jobId", "ok", "protocolVersion", "result", "type"])
    ) {
      throw new TypeError("BUILD_CANDIDATE_CHILD_MESSAGE_INVALID");
    }
    try {
      return Object.freeze({
        jobId: command.jobId,
        ok: true,
        protocolVersion: candidateJobChildProtocolVersion,
        result: parseCandidateBuildArtifact(value.result, command),
        type: "result",
      });
    } catch {
      throw new TypeError("BUILD_CANDIDATE_CHILD_MESSAGE_INVALID");
    }
  }
  if (
    !exactKeys(value, [
      "jobId",
      "ok",
      "protocolVersion",
      "safeErrorClass",
      "safeErrorCode",
      "type",
    ]) ||
    typeof value.safeErrorClass !== "string" ||
    !safeErrorClasses.has(
      value.safeErrorClass as NonNullable<JobResultMessage["safeErrorClass"]>,
    ) ||
    !isSafeErrorCode(value.safeErrorCode)
  ) {
    throw new TypeError("BUILD_CANDIDATE_CHILD_MESSAGE_INVALID");
  }
  return Object.freeze(value as unknown as BuildCandidateFailureMessage);
}

export function isRunJobMessage(value: unknown): value is RunJobMessage {
  if (!isRecord(value) || value.type !== "run") return false;
  if (value.protocolVersion !== jobChildProtocolVersion) return false;
  const input = value.input;
  if (!isRecord(input)) return false;
  if (input.kind === "build_candidate") {
    try {
      parseBuildCandidateCommand(input);
      return true;
    } catch {
      return false;
    }
  }
  const baseKeys = [
    "attempt",
    "createdAtMs",
    "jobId",
    "kind",
    "stagingRelativePath",
  ] as const;
  if (!(
    isOpaqueId("job", String(input.jobId)) &&
    jobKinds.includes(input.kind as JobKind) &&
    Number.isSafeInteger(input.attempt) &&
    Number(input.attempt) >= 1 &&
    Number.isSafeInteger(input.createdAtMs) &&
    Number(input.createdAtMs) >= 0 &&
    input.stagingRelativePath === `staging/${input.jobId}`
  )) {
    return false;
  }
  if (input.kind === "reconcile") return exactKeys(input, baseKeys);
  if (input.kind === "reclaim") {
    return (
      exactKeys(input, [...baseKeys, "bookId"]) &&
      isNullablePositiveInteger(input.bookId)
    );
  }
  if (input.kind === "verify_version") {
    return (
      exactKeys(input, [...baseKeys, "versionId"]) &&
      typeof input.versionId === "string" &&
      isOpaqueId("version", input.versionId)
    );
  }
  if (input.kind === "analyze_import") {
    return (
      exactKeys(input, [...baseKeys, "importId", "importUploadRelativePath"]) &&
      typeof input.importId === "string" &&
      isOpaqueId("import", input.importId) &&
      input.importUploadRelativePath ===
        `tmp/uploads/${input.importId}/original.zip`
    );
  }
  if (input.kind === "prepare_draft") {
    const keys = [
      ...baseKeys,
      "bookId",
      "capturedConfigRevision",
      "capturedSourceId",
      "configYamlRelativePath",
      "importId",
      "importUploadRelativePath",
      "selectedCandidateRelativePath",
      "sourceRootRelativePath",
      ...(Object.hasOwn(input, "typographyProfile")
        ? ["typographyProfile"]
        : []),
    ];
    const reprocess = input.typographyProfile != null;
    return (
      exactKeys(input, keys) &&
      isNullableTypographyProfile(input.typographyProfile) &&
      isNullablePositiveInteger(input.bookId) &&
      input.bookId !== null &&
      typeof input.importId === "string" &&
      isOpaqueId("import", input.importId) &&
      input.importUploadRelativePath ===
        `tmp/uploads/${input.importId}/original.zip` &&
      typeof input.selectedCandidateRelativePath === "string" &&
      input.selectedCandidateRelativePath.length > 0 &&
      (reprocess
        ? isNullablePositiveInteger(input.capturedConfigRevision) &&
          input.capturedConfigRevision !== null &&
          typeof input.capturedSourceId === "string" &&
          isOpaqueId("source", input.capturedSourceId) &&
          typeof input.configYamlRelativePath === "string" &&
          typeof input.sourceRootRelativePath === "string"
        : input.capturedConfigRevision === null &&
          input.capturedSourceId === null &&
          input.configYamlRelativePath === null &&
          input.sourceRootRelativePath === null)
    );
  }
  return false;
}

export function isCancelJobMessage(value: unknown): value is CancelJobMessage {
  return (
    isRecord(value) &&
    value.type === "cancel" &&
    value.protocolVersion === jobChildProtocolVersion &&
    typeof value.jobId === "string" &&
    isOpaqueId("job", value.jobId)
  );
}

export function isChildToParentMessage(
  value: unknown,
): value is ChildToParentMessage {
  if (
    !isRecord(value) ||
    value.protocolVersion !== jobChildProtocolVersion ||
    typeof value.jobId !== "string" ||
    !isOpaqueId("job", value.jobId)
  ) {
    return false;
  }
  if (value.type === "progress") {
    return (
      typeof value.phase === "string" &&
      isKnownJobPhase(value.phase) &&
      isJobProgress(value.progress)
    );
  }
  if (value.type !== "result" || typeof value.ok !== "boolean") return false;
  if (value.result !== undefined && !isSafeScalarRecord(value.result)) {
    return false;
  }
  if (
    value.safeErrorCode !== undefined &&
    (typeof value.safeErrorCode !== "string" ||
      !/^[A-Z][A-Z0-9_]{2,79}$/.test(value.safeErrorCode))
  ) {
    return false;
  }
  return true;
}
