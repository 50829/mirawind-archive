export interface JobChildRequest {
  readonly jobId: string;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface JobChildResult {
  readonly jobId: string;
  readonly ok: boolean;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly safeErrorCode?: string;
}

function isJobChildRequest(value: unknown): value is JobChildRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<JobChildRequest>;
  return (
    typeof candidate.jobId === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null
  );
}

process.on("message", (message: unknown) => {
  if (!isJobChildRequest(message)) {
    process.send?.({
      jobId: "unknown",
      ok: false,
      safeErrorCode: "INVALID_JOB_CHILD_REQUEST",
    } satisfies JobChildResult);
    return;
  }

  process.send?.({
    jobId: message.jobId,
    ok: false,
    safeErrorCode: "JOB_HANDLER_NOT_IMPLEMENTED",
  } satisfies JobChildResult);
});
