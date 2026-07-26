import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultJobTerminationGraceMs,
  defaultJobTimeoutMs,
  runJobChild,
} from "@/worker/child-runner";
import type { FrozenJobInput } from "@/worker/protocol";

const fixturePath = fileURLToPath(
  new URL("../../fixtures/processes/stubborn-job-child.mjs", import.meta.url),
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirawind-child-termination-"));
  temporaryRoots.push(root);
  return root;
}

function input(suffix: string): FrozenJobInput {
  const jobId = `job_0123456789abcdef${suffix}`;
  return {
    attempt: 1,
    bookId: null,
    capturedConfigRevision: null,
    capturedCurrentVersionId: null,
    capturedSourceId: null,
    configYamlRelativePath: null,
    createdAtMs: 1_000,
    importId: null,
    importUploadRelativePath: null,
    jobId,
    kind: "reconcile",
    selectedCandidateRelativePath: null,
    sourceRootRelativePath: null,
    stagingRelativePath: `staging/${jobId}`,
    versionId: null,
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!processExists(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`TEST_PROCESS_DID_NOT_EXIT:${pid}`);
}

describe("job child termination", () => {
  it("keeps the frozen 30-minute timeout and 10-second grace defaults", () => {
    expect(defaultJobTimeoutMs).toBe(30 * 60 * 1_000);
    expect(defaultJobTerminationGraceMs).toBe(10_000);
  });

  it.skipIf(process.platform === "win32")(
    "requests cancellation, waits the grace, SIGKILLs the whole group and resolves only after close",
    async () => {
      const root = await temporaryRoot();
      const controller = new AbortController();
      let ready!: () => void;
      const readyPromise = new Promise<void>((resolve) => {
        ready = resolve;
      });
      let settled = false;
      const startedAt = performance.now();
      const executionPromise = runJobChild(input("cancel"), {
        childModulePath: fixturePath,
        onProgress(progress) {
          if (progress.phase === "reconcile_storage") ready();
        },
        signal: controller.signal,
        storageRoot: root,
        terminationGraceMs: 80,
        timeoutMs: 5_000,
      }).then((execution) => {
        settled = true;
        return execution;
      });
      await readyPromise;
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(settled).toBe(false);

      const execution = await executionPromise;
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(70);
      expect(execution.signal).toBe("SIGKILL");
      const events = await readFile(
        join(root, "termination-events.txt"),
        "utf8",
      );
      expect(events).toContain("cancel");
      expect(events).toContain("sigterm");
      const pids = JSON.parse(
        await readFile(join(root, "termination-pids.json"), "utf8"),
      ) as { child: number; grandchild: number };
      await waitForProcessExit(pids.child);
      await waitForProcessExit(pids.grandchild);
    },
  );

  it.skipIf(process.platform === "win32")(
    "classifies the simulated 30-minute timeout distinctly before forced close",
    async () => {
      const root = await temporaryRoot();
      const execution = await runJobChild(input("timeout"), {
        childModulePath: fixturePath,
        storageRoot: root,
        terminationGraceMs: 30,
        timeoutMs: 500,
      });
      expect(execution.result).toMatchObject({
        ok: false,
        safeErrorClass: "timeout",
        safeErrorCode: "JOB_TIMEOUT",
      });
      expect(execution.signal).toBe("SIGKILL");
    },
  );
});
