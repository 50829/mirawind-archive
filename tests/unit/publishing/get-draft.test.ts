import { describe, expect, it } from "vitest";

import { createOpaqueId } from "@/domain/ids";
import { getCurrentDraftCandidate } from "@/modules/publishing/application/publishing-api";

describe("current draft candidate projection", () => {
  it("returns one bounded ready candidate for the current revision", () => {
    const attemptId = createOpaqueId("draftCandidate");
    const versionId = createOpaqueId("version");
    expect(
      getCurrentDraftCandidate({
        bookId: 7,
        candidate: {
          attemptId,
          sourceUpdatedAt: 3000,
          previewUrl: `/api/manage/books/7/preview/${attemptId}/pages/1`,
          safeErrorCode: null,
          semanticDigest: "a".repeat(64),
          state: "ready",
          versionId,
        },
        sourceUpdatedAt: 3000,
      }),
    ).toEqual({
      attempt_id: attemptId,
      preview_url: `/api/manage/books/7/preview/${attemptId}/pages/1`,
      source_updated_at: 3000,
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
          sourceUpdatedAt: 3000,
          previewUrl: null,
          safeErrorCode: "CANDIDATE_BUILD_FAILED",
          semanticDigest: null,
          state: "failed",
          versionId: null,
        },
        sourceUpdatedAt: 3000,
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
      sourceUpdatedAt: 3000,
      previewUrl: null,
      safeErrorCode: null,
      semanticDigest: null,
      state: "building" as const,
      versionId: null,
    };
    for (const candidate of [
      { ...valid, sourceUpdatedAt: 2000 },
      {
        ...valid,
        previewUrl: `/api/manage/books/7/preview/${valid.attemptId}/pages/1`,
      },
      { ...valid, safeErrorCode: "private failure detail" },
      {
        ...valid,
        previewUrl: `/api/manage/books/7/preview/${valid.attemptId}/pages/1`,
        semanticDigest: "a".repeat(64),
        state: "ready" as const,
      },
    ]) {
      expect(() =>
        getCurrentDraftCandidate({
          bookId: 7,
          candidate,
          sourceUpdatedAt: 3000,
        }),
      ).toThrow("DRAFT_CANDIDATE_PROJECTION_INVALID");
    }
  });
});
