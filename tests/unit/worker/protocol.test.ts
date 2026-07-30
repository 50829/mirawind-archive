import { describe, expect, it } from "vitest";

import { createOpaqueId } from "@/domain/ids";
import {
  dispatchJobCommand,
  type JobCommandRegistry,
} from "@/entrypoints/worker/job-registry";
import { shouldReportJobProgress } from "@/entrypoints/worker/progress-throttle";
import {
  isChildToParentMessage,
  isRunJobMessage,
  jobChildProtocolVersion,
} from "@/entrypoints/worker/protocol";

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
        createdAtMs: 1,
        jobId,
        kind: "reconcile",
        stagingRelativePath: `staging/${jobId}`,
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
    expect(
      isRunJobMessage({
        ...message,
        input: { ...message.input, unexpected: true },
      }),
    ).toBe(false);
  });

  it("dispatches the closed command union through an exhaustive registry", () => {
    const handled: string[] = [];
    const handler = (command: { readonly kind: string }) => {
      handled.push(command.kind);
      return command.kind;
    };
    const registry = {
      analyze_import: handler,
      build_candidate: handler,
      prepare_draft: handler,
      purge_book: handler,
      reclaim_versions: handler,
      reconcile: handler,
      verify_version: handler,
    } satisfies JobCommandRegistry<string>;
    const jobId = createOpaqueId("job");

    expect(
      dispatchJobCommand(
        {
          attempt: 1,
          createdAtMs: 1,
          jobId,
          kind: "reconcile",
          stagingRelativePath: `staging/${jobId}`,
        },
        registry,
      ),
    ).toBe("reconcile");
    expect(handled).toEqual(["reconcile"]);
  });

  it("binds analyze jobs to the matching durable import upload path", () => {
    const jobId = createOpaqueId("job");
    const importId = createOpaqueId("import");
    const message = {
      input: {
        attempt: 1,
        createdAtMs: 1,
        importId,
        importUploadRelativePath: `tmp/uploads/${importId}/original.zip`,
        jobId,
        kind: "analyze_import",
        stagingRelativePath: `staging/${jobId}`,
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

  it("requires the complete immutable candidate build capture", () => {
    const bookId = 1;
    const candidateId = createOpaqueId("draftCandidate");
    const jobId = createOpaqueId("job");
    const sourceId = createOpaqueId("source");
    const versionId = createOpaqueId("version");
    const message = {
      input: {
        bookId,
        candidateId,
        capturedCurrentVersionId: null,
        compilerIdentity: "compiler-v5",
        configRelativePath: `books/${bookId}/draft/configs/2/book.yaml`,
        configRevision: 2,
        jobId,
        kind: "build_candidate",
        previewIdentity: "draft-preview-v5",
        readerIdentity: "mirawind-reader-v2-tailwind-4.3.3",
        rendererIdentity: "semantic-html-v5-katex-0.18.1",
        sourceId,
        sourceRootRelativePath: `books/${bookId}/draft/sources/${sourceId}`,
        versionId,
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
