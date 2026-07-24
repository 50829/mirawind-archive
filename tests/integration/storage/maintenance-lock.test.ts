import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireMaintenanceLock,
  serviceIsRunning,
} from "@/storage/maintenance-lock";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "mirawind-maintenance-"));
  roots.push(path);
  return path;
}

describe("offline maintenance locking", () => {
  it("allows only one maintenance owner", async () => {
    const dataRoot = await root();
    const lock = await acquireMaintenanceLock(dataRoot);
    await expect(acquireMaintenanceLock(dataRoot)).rejects.toMatchObject({
      code: "EEXIST",
    });
    await lock.release();
    const next = await acquireMaintenanceLock(dataRoot);
    await next.release();
  });

  it("detects a live service PID and ignores a stale PID", async () => {
    const dataRoot = await root();
    await writeFile(join(dataRoot, "service.lock"), `${process.pid}\n`);
    await expect(serviceIsRunning(dataRoot)).resolves.toBe(true);
    await expect(acquireMaintenanceLock(dataRoot)).rejects.toThrow(
      "SERVICE_RUNNING",
    );

    await writeFile(join(dataRoot, "service.lock"), "2147483647\n");
    await expect(serviceIsRunning(dataRoot)).resolves.toBe(false);
  });
});
