import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  isChildToParentMessage,
  jobChildProtocolVersion,
  type FrozenJobInput,
  type JobProgressMessage,
  type JobResultMessage,
  type RunJobMessage,
} from "./protocol.js";

export interface ChildExecution {
  readonly exitCode: number | null;
  readonly result: JobResultMessage;
  readonly signal: NodeJS.Signals | null;
}

export interface ChildRunnerOptions {
  readonly childModulePath?: string;
  readonly onProgress?: (progress: JobProgressMessage) => void;
  readonly signal?: AbortSignal;
}

function defaultChildModulePath(): string {
  const extension = fileURLToPath(import.meta.url).endsWith(".ts")
    ? ".ts"
    : ".js";
  return fileURLToPath(new URL(`./job-child${extension}`, import.meta.url));
}

function safeChildExecArgv(arguments_: readonly string[]): string[] {
  const safe: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (
      argument === "-e" ||
      argument === "--eval" ||
      argument === "-p" ||
      argument === "--print"
    ) {
      index += 1;
      continue;
    }
    if (
      argument?.startsWith("--input-type") ||
      argument?.startsWith("--eval=") ||
      argument?.startsWith("--print=")
    ) {
      continue;
    }
    if (argument) safe.push(argument);
  }
  return safe;
}

function safeFailure(jobId: string, safeErrorCode: string): JobResultMessage {
  return {
    jobId,
    ok: false,
    protocolVersion: jobChildProtocolVersion,
    safeErrorClass: "infrastructure",
    safeErrorCode,
    type: "result",
  };
}

function stopChild(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }
}

export async function runJobChild(
  input: FrozenJobInput,
  options: ChildRunnerOptions = {},
): Promise<ChildExecution> {
  const child = fork(options.childModulePath ?? defaultChildModulePath(), [], {
    detached: process.platform !== "win32",
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH,
    },
    execArgv: safeChildExecArgv(process.execArgv),
    serialization: "json",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout?.resume();
  child.stderr?.resume();

  let result: JobResultMessage | undefined;
  const onAbort = () => {
    child.send({
      jobId: input.jobId,
      protocolVersion: jobChildProtocolVersion,
      type: "cancel",
    });
    stopChild(child);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  return new Promise<ChildExecution>((resolve) => {
    child.on("message", (message: unknown) => {
      if (!isChildToParentMessage(message) || message.jobId !== input.jobId) {
        result = safeFailure(input.jobId, "INVALID_JOB_CHILD_MESSAGE");
        stopChild(child);
        return;
      }
      if (message.type === "progress") {
        options.onProgress?.(message);
        return;
      }
      result = message;
    });
    child.once("error", () => {
      result = safeFailure(input.jobId, "JOB_CHILD_SPAWN_FAILED");
    });
    child.once("close", (exitCode, signal) => {
      options.signal?.removeEventListener("abort", onAbort);
      child.unref();
      resolve({
        exitCode,
        result:
          result ??
          safeFailure(
            input.jobId,
            signal ? "JOB_CHILD_SIGNAL_EXIT" : "JOB_CHILD_MISSING_RESULT",
          ),
        signal,
      });
    });

    const request: RunJobMessage = {
      input,
      protocolVersion: jobChildProtocolVersion,
      type: "run",
    };
    child.send(request, (error) => {
      if (error) {
        result = safeFailure(input.jobId, "JOB_CHILD_IPC_SEND_FAILED");
        stopChild(child);
      }
    });
  });
}
