import {
  isCancelJobMessage,
  isRunJobMessage,
  jobChildProtocolVersion,
  type JobResultMessage,
  type RunJobMessage,
} from "./protocol.js";

let active: RunJobMessage | undefined;
const controller = new AbortController();

function send(result: JobResultMessage): void {
  process.send?.(result, () => {
    if (process.connected) process.disconnect();
  });
}

process.on("message", (message: unknown) => {
  if (isCancelJobMessage(message)) {
    if (active?.input.jobId === message.jobId) controller.abort();
    return;
  }
  if (!isRunJobMessage(message) || active) {
    send({
      jobId:
        typeof message === "object" &&
        message !== null &&
        "jobId" in message &&
        typeof message.jobId === "string"
          ? message.jobId
          : "job_invalid",
      ok: false,
      protocolVersion: jobChildProtocolVersion,
      safeErrorClass: "infrastructure",
      safeErrorCode: "INVALID_JOB_CHILD_REQUEST",
      type: "result",
    });
    return;
  }

  active = message;
  if (controller.signal.aborted) {
    send({
      jobId: message.input.jobId,
      ok: false,
      protocolVersion: jobChildProtocolVersion,
      safeErrorClass: "canceled",
      safeErrorCode: "JOB_CANCELED",
      type: "result",
    });
    return;
  }
  send({
    jobId: message.input.jobId,
    ok: false,
    protocolVersion: jobChildProtocolVersion,
    safeErrorClass: "infrastructure",
    safeErrorCode: "JOB_HANDLER_NOT_IMPLEMENTED",
    type: "result",
  });
});
