import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  isChildToParentMessage,
  jobChildProtocolVersion,
  type FrozenJobInput,
  type JobProgressMessage,
  type JobResultMessage,
  type RunJobMessage,
} from "@/entrypoints/worker/protocol";

export interface ChildExecution {
  readonly exitCode: number | null;
  readonly result: JobResultMessage;
  readonly signal: NodeJS.Signals | null;
}

export interface ChildRunnerOptions {
  readonly childModulePath?: string;
  readonly onProgress?: (progress: JobProgressMessage) => void;
  readonly signal?: AbortSignal;
  readonly storageRoot?: string;
  readonly terminationGraceMs?: number;
  readonly timeoutMs?: number;
}

export const defaultJobTerminationGraceMs = 10_000;
export const defaultJobTimeoutMs = 30 * 60 * 1_000;

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

function safeFailure(
  jobId: string,
  safeErrorCode: string,
  safeErrorClass: NonNullable<
    JobResultMessage["safeErrorClass"]
  > = "infrastructure",
): JobResultMessage {
  return {
    jobId,
    ok: false,
    protocolVersion: jobChildProtocolVersion,
    safeErrorClass,
    safeErrorCode,
    type: "result",
  };
}

function checkedDuration(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const duration = value ?? fallback;
  if (!Number.isSafeInteger(duration) || duration < 0) {
    throw new RangeError(`${label}_INVALID`);
  }
  return duration;
}

function signalChildTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    child.pid === undefined
  ) {
    return;
  }
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ESRCH"
    ) {
      throw error;
    }
  }
}

export async function runJobChild(
  input: FrozenJobInput,
  options: ChildRunnerOptions = {},
): Promise<ChildExecution> {
  const terminationGraceMs = checkedDuration(
    options.terminationGraceMs,
    defaultJobTerminationGraceMs,
    "JOB_TERMINATION_GRACE",
  );
  const timeoutMs = checkedDuration(
    options.timeoutMs,
    defaultJobTimeoutMs,
    "JOB_TIMEOUT",
  );
  const child = fork(options.childModulePath ?? defaultChildModulePath(), [], {
    detached: process.platform !== "win32",
    env: {
      ...(options.storageRoot
        ? { MIRAWIND_JOB_STORAGE_ROOT: options.storageRoot }
        : {}),
      ...(process.env.MIRAWIND_PIPELINE_PROFILE_DIR
        ? {
            MIRAWIND_PIPELINE_PROFILE_DIR:
              process.env.MIRAWIND_PIPELINE_PROFILE_DIR,
          }
        : {}),
      ...(process.env.MIRAWIND_PIPELINE_CPU_PROFILE_DIR
        ? {
            MIRAWIND_PIPELINE_CPU_PROFILE_DIR:
              process.env.MIRAWIND_PIPELINE_CPU_PROFILE_DIR,
          }
        : {}),
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
  let terminationStarted = false;
  let forceKillTimer: NodeJS.Timeout | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;

  const requestTermination = (cause: "abort" | "failure" | "timeout"): void => {
    if (terminationStarted) return;
    terminationStarted = true;
    if (cause === "timeout") {
      result = safeFailure(input.jobId, "JOB_TIMEOUT", "timeout");
    }
    if (child.connected) {
      child.send(
        {
          jobId: input.jobId,
          protocolVersion: jobChildProtocolVersion,
          type: "cancel",
        },
        () => undefined,
      );
    }
    signalChildTree(child, "SIGTERM");
    forceKillTimer = setTimeout(() => {
      signalChildTree(child, "SIGKILL");
    }, terminationGraceMs);
    forceKillTimer.unref();
  };
  const onAbort = () => requestTermination("abort");
  options.signal?.addEventListener("abort", onAbort, { once: true });

  return new Promise<ChildExecution>((resolve) => {
    child.on("message", (message: unknown) => {
      if (!isChildToParentMessage(message) || message.jobId !== input.jobId) {
        result = safeFailure(input.jobId, "INVALID_JOB_CHILD_MESSAGE");
        requestTermination("failure");
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
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
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
        result ??= safeFailure(input.jobId, "JOB_CHILD_IPC_SEND_FAILED");
        requestTermination("failure");
      }
    });
    timeoutTimer = setTimeout(() => requestTermination("timeout"), timeoutMs);
    timeoutTimer.unref();
    if (options.signal?.aborted) onAbort();
  });
}
