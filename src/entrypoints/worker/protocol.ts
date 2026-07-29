import { isOpaqueId } from "@/domain/ids";
import {
  isKnownJobPhase,
  jobKinds,
  type JobKind,
  type JobPhase,
  type TypographyProfile,
} from "@/modules/publishing/application/public";

export const jobChildProtocolVersion = 2;

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

export interface BuildPreviewCommand extends FrozenJobCommandBase {
  readonly bookId: number;
  readonly capturedConfigRevision: number;
  readonly capturedSourceId: string;
  readonly configYamlRelativePath: string;
  readonly kind: "build_preview";
  readonly sourceRootRelativePath: string;
}

export interface BuildPublishCommand extends FrozenJobCommandBase {
  readonly bookId: number;
  readonly capturedConfigRevision: number;
  readonly capturedCurrentVersionId: string | null;
  readonly capturedSourceId: string;
  readonly configYamlRelativePath: string;
  readonly kind: "build_publish";
  readonly sourceRootRelativePath: string;
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
  | BuildPreviewCommand
  | BuildPublishCommand
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

export function isRunJobMessage(value: unknown): value is RunJobMessage {
  if (!isRecord(value) || value.type !== "run") return false;
  if (value.protocolVersion !== jobChildProtocolVersion) return false;
  const input = value.input;
  if (!isRecord(input)) return false;
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
  const buildKeys = [
    ...baseKeys,
    "bookId",
    "capturedConfigRevision",
    "capturedSourceId",
    "configYamlRelativePath",
    "sourceRootRelativePath",
    ...(input.kind === "build_publish" ? ["capturedCurrentVersionId"] : []),
  ];
  return (
    exactKeys(input, buildKeys) &&
    isNullablePositiveInteger(input.bookId) &&
    input.bookId !== null &&
    isNullablePositiveInteger(input.capturedConfigRevision) &&
    input.capturedConfigRevision !== null &&
    typeof input.capturedSourceId === "string" &&
    isOpaqueId("source", input.capturedSourceId) &&
    typeof input.configYamlRelativePath === "string" &&
    input.configYamlRelativePath.length > 0 &&
    typeof input.sourceRootRelativePath === "string" &&
    input.sourceRootRelativePath.length > 0 &&
    (input.kind !== "build_publish" ||
      input.capturedCurrentVersionId === null ||
      (typeof input.capturedCurrentVersionId === "string" &&
        isOpaqueId("version", input.capturedCurrentVersionId)))
  );
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
