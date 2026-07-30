import {
  type ChildProcess,
  spawn,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { waitForHttp } from "./http";

interface ManagedTestProcess {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly stop: () => Promise<void>;
  readonly waitForOutput: (
    pattern: RegExp,
    timeoutMs?: number,
  ) => Promise<string>;
}

interface RuntimeProcessOptions {
  readonly dataRoot: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly publicOrigin: string;
}

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const webEntry = resolve(repositoryRoot, "dist/server/entry.mjs");
const workerEntry = resolve(repositoryRoot, "dist/processes/worker/index.js");
const maximumCapturedOutput = 64 * 1024;

function runtimeEnvironment(options: RuntimeProcessOptions): NodeJS.ProcessEnv {
  const origin = new URL(options.publicOrigin);
  return {
    ...process.env,
    ...options.environment,
    MIRAWIND_ALLOWED_HOSTS: [origin.hostname, "127.0.0.1", "localhost"].join(
      ",",
    ),
    MIRAWIND_AUTH_SECRET: "test-only-secret-0123456789-abcdef",
    MIRAWIND_DATA_DIR: options.dataRoot,
    MIRAWIND_PASSKEY_RP_ID: origin.hostname,
    MIRAWIND_PUBLIC_ORIGIN: origin.origin,
    NODE_ENV: "test",
  };
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

export function startManagedTestProcess(
  executable: string,
  arguments_: readonly string[],
  options: SpawnOptionsWithoutStdio = {},
): ManagedTestProcess {
  const child = spawn(executable, arguments_, {
    ...options,
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let capturedOutput = "";
  let exited:
    | {
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
      }
    | undefined;
  const appendOutput = (chunk: Buffer) => {
    capturedOutput = `${capturedOutput}${chunk.toString("utf8")}`.slice(
      -maximumCapturedOutput,
    );
  };
  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);
  const exitPromise = new Promise<typeof exited>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      exited = { code, signal };
      resolveExit(exited);
    });
  });
  let stopped = false;

  return Object.freeze({
    child,
    output: () => capturedOutput,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (exited) return;
      signalProcessGroup(child, "SIGTERM");
      const graceful = await Promise.race([
        exitPromise.then(() => true),
        new Promise<false>((resolveTimeout) =>
          setTimeout(() => resolveTimeout(false), 5_000),
        ),
      ]);
      if (!graceful) {
        signalProcessGroup(child, "SIGKILL");
        await exitPromise;
      }
    },
    async waitForOutput(pattern: RegExp, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (pattern.test(capturedOutput)) return capturedOutput;
        if (exited) {
          throw new Error(
            `Process exited (${exited.code ?? exited.signal}) before output matched ${pattern}: ${capturedOutput}`,
          );
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      throw new Error(
        `Process output did not match ${pattern} within ${timeoutMs} ms: ${capturedOutput}`,
      );
    },
  });
}

async function requireBuildEntry(path: string): Promise<void> {
  try {
    await access(path);
  } catch (cause) {
    throw new Error(
      `Production entry is missing at ${path}; run pnpm build before starting process tests`,
      { cause },
    );
  }
}

export async function reserveTcpPort(): Promise<number> {
  const server = createServer();
  return new Promise<number>((resolvePort, rejectPort) => {
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("Could not reserve a TCP port"));
        return;
      }
      server.close((error) => {
        if (error) rejectPort(error);
        else resolvePort(address.port);
      });
    });
  });
}

export async function startWebProcess(input: {
  readonly dataRoot: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly port?: number;
}): Promise<ManagedTestProcess & { readonly origin: string }> {
  await requireBuildEntry(webEntry);
  const port = input.port ?? (await reserveTcpPort());
  const origin = `http://localhost:${port}`;
  const processHandle = startManagedTestProcess(process.execPath, [webEntry], {
    cwd: repositoryRoot,
    env: {
      ...runtimeEnvironment({
        dataRoot: input.dataRoot,
        ...(input.environment ? { environment: input.environment } : {}),
        publicOrigin: origin,
      }),
      HOST: "127.0.0.1",
      PORT: String(port),
    },
  });
  try {
    await waitForHttp(`${origin}/login`);
    return Object.freeze({ ...processHandle, origin });
  } catch (error) {
    await processHandle.stop();
    throw new Error(
      `Web process failed to become ready: ${processHandle.output()}`,
      {
        cause: error,
      },
    );
  }
}

export async function startWorkerProcess(
  input: RuntimeProcessOptions,
): Promise<ManagedTestProcess> {
  await requireBuildEntry(workerEntry);
  const processHandle = startManagedTestProcess(
    process.execPath,
    [workerEntry],
    {
      cwd: repositoryRoot,
      env: runtimeEnvironment(input),
    },
  );
  try {
    await processHandle.waitForOutput(/Mirawind worker ready/);
    return processHandle;
  } catch (error) {
    await processHandle.stop();
    throw error;
  }
}
