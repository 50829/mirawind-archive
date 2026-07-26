import { isOpaqueId } from "../domain/ids.js";
import {
  isKnownJobPhase,
  jobKinds,
  type JobKind,
  type JobPhase,
} from "../jobs/state-machine.js";
import type { TypographyProfile } from "../compiler/document/types.js";

export const jobChildProtocolVersion = 2;

export interface FrozenJobInput {
  readonly attempt: number;
  readonly bookId: number | null;
  readonly capturedConfigRevision: number | null;
  readonly capturedCurrentVersionId: string | null;
  readonly capturedSourceId: string | null;
  readonly configYamlRelativePath: string | null;
  readonly createdAtMs: number;
  readonly importId: string | null;
  readonly importUploadRelativePath: string | null;
  readonly jobId: string;
  readonly kind: JobKind;
  readonly selectedCandidateRelativePath: string | null;
  readonly sourceRootRelativePath: string | null;
  readonly stagingRelativePath: string;
  readonly typographyProfile?: TypographyProfile | null;
  readonly versionId: string | null;
}

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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
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
  return (
    isOpaqueId("job", String(input.jobId)) &&
    jobKinds.includes(input.kind as JobKind) &&
    Number.isSafeInteger(input.attempt) &&
    Number(input.attempt) >= 1 &&
    Number.isSafeInteger(input.createdAtMs) &&
    Number(input.createdAtMs) >= 0 &&
    isNullablePositiveInteger(input.bookId) &&
    isNullablePositiveInteger(input.capturedConfigRevision) &&
    isNullableString(input.capturedCurrentVersionId) &&
    isNullableString(input.capturedSourceId) &&
    isNullableString(input.configYamlRelativePath) &&
    isNullableString(input.importId) &&
    isNullableString(input.importUploadRelativePath) &&
    isNullableString(input.versionId) &&
    isNullableString(input.selectedCandidateRelativePath) &&
    isNullableString(input.sourceRootRelativePath) &&
    isNullableTypographyProfile(input.typographyProfile) &&
    input.stagingRelativePath === `staging/${input.jobId}` &&
    (input.kind === "analyze_import" || input.kind === "prepare_draft"
      ? input.importId !== null &&
        input.importUploadRelativePath ===
          `tmp/uploads/${input.importId}/original.zip`
      : input.importUploadRelativePath === null) &&
    (input.kind === "prepare_draft"
      ? input.bookId !== null &&
        input.selectedCandidateRelativePath !== null &&
        (input.typographyProfile == null ||
          (input.capturedSourceId !== null &&
            input.capturedConfigRevision !== null))
      : input.selectedCandidateRelativePath === null) &&
    (input.kind === "build_preview" || input.kind === "build_publish"
      ? input.bookId !== null &&
        input.capturedConfigRevision !== null &&
        input.capturedSourceId !== null &&
        input.sourceRootRelativePath !== null &&
        input.configYamlRelativePath !== null
      : input.kind === "prepare_draft" && input.typographyProfile != null
        ? input.sourceRootRelativePath !== null &&
          input.configYamlRelativePath !== null
        : input.sourceRootRelativePath === null &&
          input.configYamlRelativePath === null)
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
