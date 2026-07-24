import { describe, expect, it } from "vitest";

import { createOpaqueId } from "@/domain/ids";
import {
  isChildToParentMessage,
  isRunJobMessage,
  jobChildProtocolVersion,
} from "@/worker/protocol";

describe("job child IPC protocol", () => {
  it("accepts only frozen job inputs with a job-scoped staging path", () => {
    const jobId = createOpaqueId("job");
    const message = {
      input: {
        attempt: 1,
        bookId: null,
        capturedConfigRevision: null,
        capturedCurrentVersionId: null,
        capturedSourceId: null,
        importId: null,
        jobId,
        kind: "reconcile",
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

  it("rejects content-sized or structurally unsafe child progress", () => {
    const base = {
      jobId: createOpaqueId("job"),
      phase: "extract",
      protocolVersion: jobChildProtocolVersion,
      type: "progress",
    };
    expect(
      isChildToParentMessage({
        ...base,
        progress: { entries: 12, ratio: 3.5 },
      }),
    ).toBe(true);
    expect(
      isChildToParentMessage({
        ...base,
        progress: { markdown: "x".repeat(501) },
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
