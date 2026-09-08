import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForDraftSave } from "@/web/components/manage/wait-for-save";

const first = "job_000000000000000000000001";
const second = "job_000000000000000000000002";
afterEach(() => vi.unstubAllGlobals());
describe("save acceptance tracking", () => {
  it("uses the exact accepted timestamp and follows a durable retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ state: "interrupted", retry_job_id: second }),
      )
      .mockResolvedValueOnce(
        Response.json({ state: "succeeded", accepted_updated_at: 1234 }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(
      await waitForDraftSave(Response.json({ job_id: first }, { status: 202 })),
    ).toBe(1234);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      `/api/manage/jobs/${first}`,
      `/api/manage/jobs/${second}`,
    ]);
  });
  it("rejects failed saves, malformed acceptance and retry cycles", async () => {
    for (const status of [
      { state: "failed", error_code: "DRAFT_PRECONDITION_FAILED" },
      { state: "succeeded", accepted_updated_at: "1234" },
      { state: "interrupted", retry_job_id: first },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(status)));
      await expect(
        waitForDraftSave(Response.json({ job_id: first }, { status: 202 })),
      ).rejects.toThrow();
    }
  });
});
