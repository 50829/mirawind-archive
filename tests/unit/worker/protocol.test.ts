import { describe, expect, it } from "vitest";

import { createOpaqueId } from "@/domain/ids";
import { shouldReportJobProgress } from "@/worker/progress-throttle";
import {
  isChildToParentMessage,
  isRunJobMessage,
  jobChildProtocolVersion,
} from "@/worker/protocol";

describe("job child IPC protocol", () => {
  it("reports phase changes immediately and limits repeated progress to 250ms", () => {
    expect(
      shouldReportJobProgress({
        lastPhase: "security_check",
        lastReportedAtMs: 1_000,
        nowMs: 1_001,
        phase: "identify_document",
      }),
    ).toBe(true);
    expect(
      shouldReportJobProgress({
        lastPhase: "security_check",
        lastReportedAtMs: 1_000,
        nowMs: 1_249,
        phase: "security_check",
      }),
    ).toBe(false);
    expect(
      shouldReportJobProgress({
        lastPhase: "security_check",
        lastReportedAtMs: 1_000,
        nowMs: 1_250,
        phase: "security_check",
      }),
    ).toBe(true);
  });

  it("accepts only frozen job inputs with a job-scoped staging path", () => {
    const jobId = createOpaqueId("job");
    const message = {
      input: {
        attempt: 1,
        bookId: null,
        capturedConfigRevision: null,
        capturedCurrentVersionId: null,
        capturedSourceId: null,
        configYamlRelativePath: null,
        createdAtMs: 1,
        importId: null,
        importUploadRelativePath: null,
        jobId,
        kind: "reconcile",
        selectedCandidateRelativePath: null,
        sourceRootRelativePath: null,
        stagingRelativePath: `staging/${jobId}`,
        versionId: null,
      },
      protocolVersion: jobChildProtocolVersion,
      type: "run",
    };
    expect(isRunJobMessage(message)).toBe(true);
    expect(
      isRunJobMessage({
        ...message,
        input: { ...message.input, stagingRelativePath: "../../escape" },
      }),
    ).toBe(false);
  });

  it("binds analyze jobs to the matching durable import upload path", () => {
    const jobId = createOpaqueId("job");
    const importId = createOpaqueId("import");
    const message = {
      input: {
        attempt: 1,
        bookId: null,
        capturedConfigRevision: null,
        capturedCurrentVersionId: null,
        capturedSourceId: null,
        configYamlRelativePath: null,
        createdAtMs: 1,
        importId,
        importUploadRelativePath: `tmp/uploads/${importId}/original.zip`,
        jobId,
        kind: "analyze_import",
        selectedCandidateRelativePath: null,
        sourceRootRelativePath: null,
        stagingRelativePath: `staging/${jobId}`,
        versionId: null,
      },
      protocolVersion: jobChildProtocolVersion,
      type: "run",
    };

    expect(isRunJobMessage(message)).toBe(true);
    expect(
      isRunJobMessage({
        ...message,
        input: {
          ...message.input,
          importUploadRelativePath: "tmp/uploads/other/original.zip",
        },
      }),
    ).toBe(false);
  });

  it("requires frozen config and source captures for publish jobs", () => {
    const jobId = createOpaqueId("job");
    const message = {
      input: {
        attempt: 1,
        bookId: 1,
        capturedConfigRevision: 2,
        capturedCurrentVersionId: null,
        capturedSourceId: createOpaqueId("source"),
        configYamlRelativePath: "books/1/draft/configs/2/book.yaml",
        createdAtMs: 1,
        importId: null,
        importUploadRelativePath: null,
        jobId,
        kind: "build_publish",
        selectedCandidateRelativePath: null,
        sourceRootRelativePath: "books/1/draft/sources/source",
        stagingRelativePath: `staging/${jobId}`,
        versionId: null,
      },
      protocolVersion: jobChildProtocolVersion,
      type: "run",
    };

    expect(isRunJobMessage(message)).toBe(true);
    expect(
      isRunJobMessage({
        ...message,
        input: { ...message.input, sourceRootRelativePath: null },
      }),
    ).toBe(false);
  });

  it("accepts only the closed bounded progress shape", () => {
    const base = {
      jobId: createOpaqueId("job"),
      phase: "security_check",
      protocolVersion: jobChildProtocolVersion,
      type: "progress",
    };
    expect(
      isChildToParentMessage({
        ...base,
        progress: {
          completed: 12,
          processed_bytes: 1024,
          total: 20,
          unit: "items",
        },
      }),
    ).toBe(true);
    expect(
      isChildToParentMessage({
        ...base,
        progress: {
          completed: 12,
          markdown: "private body",
          processed_bytes: 1024,
          total: 20,
          unit: "items",
        },
      }),
    ).toBe(false);
  });

  it("rejects unknown protocol versions and unsafe error codes", () => {
    const result = {
      jobId: createOpaqueId("job"),
      ok: false,
      protocolVersion: jobChildProtocolVersion,
      safeErrorCode: "JOB_FAILED",
      type: "result",
    };
    expect(isChildToParentMessage(result)).toBe(true);
    expect(isChildToParentMessage({ ...result, protocolVersion: 99 })).toBe(
      false,
    );
    expect(
      isChildToParentMessage({
        ...result,
        safeErrorCode: "contains secret detail",
      }),
    ).toBe(false);
  });
});
