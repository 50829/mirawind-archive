export class DraftSaveFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DraftSaveFailure";
  }
}

export async function waitForDraftSave(response: Response): Promise<number> {
  const value = (await response.json()) as { job_id?: string };
  if (!value.job_id || !/^job_[A-Za-z0-9_-]{16,80}$/u.test(value.job_id))
    throw new DraftSaveFailure("DRAFT_SAVE_RESPONSE_INVALID");
  const deadline = Date.now() + 31 * 60 * 1000;
  let jobId = value.job_id;
  const followed = new Set([jobId]);
  while (Date.now() < deadline) {
    const status = await fetch(`/api/manage/jobs/${jobId}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!status.ok) throw new DraftSaveFailure("DRAFT_SAVE_STATUS_FAILED");
    const job = (await status.json()) as {
      state: string;
      error_code?: string;
      accepted_updated_at?: number;
      retry_job_id?: string | null;
    };
    if (job.state === "succeeded") {
      const acceptedAt = job.accepted_updated_at;
      if (
        typeof acceptedAt !== "number" ||
        !Number.isSafeInteger(acceptedAt) ||
        acceptedAt < 0 ||
        acceptedAt > 8_640_000_000_000_000
      )
        throw new DraftSaveFailure("DRAFT_SAVE_RESPONSE_INVALID");
      return acceptedAt;
    }
    if (
      job.retry_job_id &&
      /^job_[A-Za-z0-9_-]{16,80}$/u.test(job.retry_job_id)
    ) {
      if (followed.has(job.retry_job_id) || followed.size >= 32)
        throw new DraftSaveFailure("DRAFT_SAVE_RESPONSE_INVALID");
      jobId = job.retry_job_id;
      followed.add(jobId);
      continue;
    }
    if (["failed", "canceled", "interrupted"].includes(job.state))
      throw new DraftSaveFailure(job.error_code ?? "DRAFT_SAVE_FAILED");
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new DraftSaveFailure("DRAFT_SAVE_TIMEOUT");
}
