import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseBuildArguments, runBuildBenchmarks } from "./build.js";

function hasArgument(arguments_: readonly string[], name: string): boolean {
  return arguments_.some((argument) => argument === name);
}

export function parsePipelineProfileArguments(arguments_: readonly string[]) {
  const normalized = hasArgument(arguments_, "--include-stress")
    ? arguments_
    : ["--include-stress", "false", ...arguments_];
  const input = parseBuildArguments(normalized);
  if (!input.realDirectory) {
    throw new Error("PIPELINE_PROFILE_REAL_DIRECTORY_REQUIRED");
  }
  if (!input.profileDirectory) {
    throw new Error("PIPELINE_PROFILE_DIRECTORY_REQUIRED");
  }
  if (!input.output) {
    throw new Error("PIPELINE_PROFILE_OUTPUT_REQUIRED");
  }
  return input;
}

function safeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const match = /\b[A-Z][A-Z0-9_]{2,79}\b/u.exec(message);
  return match?.[0] ?? "PIPELINE_PROFILE_FAILED";
}

async function main(): Promise<void> {
  const input = parsePipelineProfileArguments(process.argv.slice(2));
  const report = await runBuildBenchmarks(input);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const output = resolve(input.output as string);
  await mkdir(dirname(output), { mode: 0o700, recursive: true });
  await writeFile(output, json, { mode: 0o600 });
  process.stdout.write(json);
  if (report.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeFailureCode(error)}\n`);
    process.exitCode = 1;
  });
}
