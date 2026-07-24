import { constants } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

export interface MaintenanceLock {
  readonly path: string;
  release(): Promise<void>;
}

async function processExists(processId: number): Promise<boolean> {
  if (!Number.isSafeInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    );
  }
}

export async function serviceIsRunning(dataRoot: string): Promise<boolean> {
  try {
    const raw = await readFile(resolve(dataRoot, "service.lock"), "utf8");
    return processExists(Number.parseInt(raw.trim(), 10));
  } catch {
    return false;
  }
}

export async function acquireMaintenanceLock(
  dataRoot: string,
): Promise<MaintenanceLock> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  if (await serviceIsRunning(dataRoot)) {
    throw new Error("SERVICE_RUNNING");
  }
  const path = resolve(dataRoot, ".maintenance.lock");
  const handle = await open(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  await handle.writeFile(`${process.pid}\n`);
  await handle.sync();
  let released = false;
  return {
    path,
    async release() {
      if (released) return;
      released = true;
      await handle.close();
      await rm(path, { force: true });
    },
  };
}
