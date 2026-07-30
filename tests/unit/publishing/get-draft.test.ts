import { describe, expect, it } from "vitest";

import { createOpaqueId } from "@/domain/ids";
import { getCurrentDraftCandidate } from "@/modules/publishing/application/public";

describe("current draft candidate projection", () => {
  it("returns one bounded ready candidate for the current revision", () => {
    const attemptId = createOpaqueId("draftCandidate");
    const versionId = createOpaqueId("version");
    expect(
      getCurrentDraftCandidate({
        bookId: 7,
        candidate: {
          attemptId,
          configRevision: 3,
          previewUrl: "/api/manage/books/7/preview/3/pages/1",
          safeErrorCode: null,
          semanticDigest: "a".repeat(64),
          state: "ready",
          versionId,
        },
        configRevision: 3,
      }),
    ).toEqual({
      attempt_id: attemptId,
      preview_url: "/api/manage/books/7/preview/3/pages/1",
      revision: 3,
      safe_error_code: null,
      semantic_digest: "a".repeat(64),
      state: "ready",
      version_id: versionId,
    });
  });

  it("allows bounded terminal evidence without exposing ready fields", () => {
    const attemptId = createOpaqueId("draftCandidate");
    expect(
      getCurrentDraftCandidate({
        bookId: 7,
        candidate: {
          attemptId,
          configRevision: 3,
          previewUrl: null,
          safeErrorCode: "CANDIDATE_BUILD_FAILED",
          semanticDigest: null,
          state: "failed",
          versionId: null,
        },
        configRevision: 3,
      }),
    ).toMatchObject({
      attempt_id: attemptId,
      safe_error_code: "CANDIDATE_BUILD_FAILED",
      state: "failed",
    });
  });

  it("rejects stale, partial-ready and unbounded projections", () => {
    const valid = {
      attemptId: createOpaqueId("draftCandidate"),
      configRevision: 3,
      previewUrl: null,
      safeErrorCode: null,
      semanticDigest: null,
      state: "building" as const,
      versionId: null,
    };
    for (const candidate of [
      { ...valid, configRevision: 2 },
      { ...valid, previewUrl: "/api/manage/books/7/preview/3/pages/1" },
      { ...valid, safeErrorCode: "private failure detail" },
      {
        ...valid,
        previewUrl: "/api/manage/books/7/preview/3/pages/1",
        semanticDigest: "a".repeat(64),
        state: "ready" as const,
      },
    ]) {
      expect(() =>
        getCurrentDraftCandidate({
          bookId: 7,
          candidate,
          configRevision: 3,
        }),
      ).toThrow("DRAFT_CANDIDATE_PROJECTION_INVALID");
    }
  });
});
