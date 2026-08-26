import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const port = process.env.PORT ?? "4322";
if (!/^[0-9]+$/.test(port) || Number(port) < 1_024 || Number(port) > 65_535) {
  throw new Error("PORT must be an integer from 1024 to 65535");
}
const environment = Object.freeze({
  HOST: "127.0.0.1",
  MIRAWIND_ALLOWED_HOSTS: "127.0.0.1,localhost",
  MIRAWIND_AUTH_SECRET: randomBytes(48).toString("base64url"),
  MIRAWIND_DATA_DIR: resolve(".cache/dev-data"),
  MIRAWIND_PASSKEY_RP_ID: "127.0.0.1",
  MIRAWIND_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
  PORT: port,
  ...process.env,
  NODE_ENV: "development",
});
const commands = Object.freeze([
  Object.freeze({
    args: ["dev", "--host", environment.HOST, "--port", environment.PORT],
    label: "web",
    program: resolve("node_modules/.bin/astro"),
  }),
  Object.freeze({
    args: ["--import", "tsx", "src/entrypoints/worker/index.ts"],
    label: "worker",
    program: process.execPath,
  }),
]);
const children = new Map();
let stopping = false;

spawnSync(commands[0].program, ["dev", "stop"], {
  env: environment,
  shell: false,
  stdio: "ignore",
});

const preparation = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/prepare-development.ts"],
  {
    env: environment,
    shell: false,
    stdio: "inherit",
  },
);
if (preparation.error) throw preparation.error;
if (preparation.status !== 0) {
  process.exit(preparation.status ?? 1);
}

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  spawnSync(commands[0].program, ["dev", "stop"], {
    env: environment,
    shell: false,
    stdio: "ignore",
  });
  for (const child of children.values()) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    }
  }
}

for (const command of commands) {
  const child = spawn(command.program, command.args, {
    detached: true,
    env: environment,
    shell: false,
    stdio: "inherit",
  });
  children.set(command.label, child);
  child.once("error", (error) => {
    process.stderr.write(
      `${command.label} failed to start: ${error.message}\n`,
    );
    process.exitCode = 1;
    stop();
  });
  child.once("exit", (code, signal) => {
    children.delete(command.label);
    if (stopping) {
      if (children.size === 0) process.exit(process.exitCode ?? 0);
      return;
    }
    if (command.label === "web" && code === 0) {
      return;
    }
    process.stderr.write(
      `${command.label} stopped${signal ? ` by ${signal}` : ` with code ${code ?? 1}`}\n`,
    );
    process.exitCode = code && code > 0 ? code : 1;
    stop();
  });
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

await new Promise((resolveExit) => process.once("exit", resolveExit));
