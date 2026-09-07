import { execFile, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { parseEnvironment } from "../src/config/environment.ts";

const environment = parseEnvironment(process.env, { mode: "development" });
const origin = new URL(environment.publicOrigin);

const existingPid = Number(
  await readFile(
    resolve(environment.dataDirectory, "tmp/worker.pid"),
    "utf8",
  ).catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  }),
);
if (Number.isSafeInteger(existingPid) && existingPid > 0) {
  try {
    process.kill(existingPid, 0);
    throw new Error(
      `A worker is already using this data directory (pid ${existingPid}). Stop that development runtime first.`,
    );
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

await promisify(execFile)(process.execPath, [
  "--import",
  "tsx",
  "scripts/prepare-development.ts",
]);

const worker = fork(resolve("src/entrypoints/worker/index.ts"), [], {
  detached: true,
  execArgv: ["--import", "tsx"],
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
worker.stdout.pipe(process.stdout);
worker.stderr.pipe(process.stderr);

let server;
let stopping;
const workerClosed = new Promise((resolveExit) =>
  worker.once("exit", resolveExit),
);
let finish;
const finished = new Promise((resolveFinish) => {
  finish = resolveFinish;
});

function stop(exitCode = 0) {
  if (stopping) return stopping;
  stopping = (async () => {
    process.exitCode = exitCode;
    worker.kill("SIGTERM");
    const force = setTimeout(() => {
      try {
        process.kill(-worker.pid, "SIGKILL");
      } catch {
        /* Already closed. */
      }
      process.stderr.write("Development shutdown timed out; forcing exit.\n");
      process.exit(exitCode || 1);
    }, 15_000);
    force.unref();
    try {
      await Promise.all([server?.stop(), workerClosed]);
    } finally {
      clearTimeout(force);
      finish();
    }
  })();
  return stopping;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    void stop();
  });
}

worker.once("exit", (code, signal) => {
  if (!stopping) {
    process.stderr.write(
      `Worker stopped (${signal ?? code}); closing development server.\n`,
    );
    void stop(1);
  }
});

try {
  await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(
      () => rejectReady(new Error("Worker startup timed out")),
      30_000,
    );
    const cleanup = () => clearTimeout(timeout);
    worker.once("message", (message) => {
      cleanup();
      if (message?.type === "ready") resolveReady();
      else rejectReady(new Error("Unexpected worker startup message"));
    });
    worker.once("error", (error) => {
      cleanup();
      rejectReady(error);
    });
    worker.once("exit", () => {
      cleanup();
      rejectReady(new Error("Worker exited before startup completed"));
    });
  });
  if (!stopping) {
    const { dev } = await import("astro");
    server = await dev({
      server: { host: origin.hostname, port: Number(origin.port || 80) },
      vite: {
        cacheDir: resolve(
          "node_modules/.vite-development",
          createHash("sha256")
            .update(environment.dataDirectory)
            .digest("hex")
            .slice(0, 16),
        ),
        server: { strictPort: true },
      },
    });
    if (stopping) await server.stop();
    else
      process.stdout.write(
        `Mirawind development ready: ${environment.publicOrigin}/manage\n`,
      );
  }
  await finished;
  process.exit(process.exitCode ?? 0);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  await stop(1);
  process.exit(1);
}
