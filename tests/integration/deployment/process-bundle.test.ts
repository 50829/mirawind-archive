import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("production process bundle", () => {
  it("resolves @ imports in worker, child and CLI entrypoints", async () => {
    const cacheDirectory = join(repositoryRoot, ".cache");
    await mkdir(cacheDirectory, { mode: 0o700, recursive: true });
    const outputDirectory = await mkdtemp(
      join(cacheDirectory, "mirawind-process-bundle-"),
    );
    temporaryDirectories.push(outputDirectory);
    await execFileAsync(
      "pnpm",
      ["exec", "vite", "build", "--config", "vite.processes.config.ts"],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          MIRAWIND_PROCESS_OUT_DIR: outputDirectory,
        },
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const entries = [
      "cli/index.js",
      "worker/index.js",
      "worker/job-child.js",
    ] as const;
    for (const entry of entries) {
      const source = await readFile(join(outputDirectory, entry), "utf8");
      expect(source).not.toContain('from "@/');
      expect(source).not.toContain("from '@/");
    }
    await expect(
      execFileAsync("node", [join(outputDirectory, "cli/index.js")], {
        cwd: repositoryRoot,
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("Usage:"),
    });
  });
});
