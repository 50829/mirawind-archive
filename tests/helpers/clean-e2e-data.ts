import { chmod, lstat, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const cacheRoot = resolve(".cache");
const e2eDirectories = [
  resolve(cacheRoot, "e2e-ir-fixtures"),
  resolve(cacheRoot, "e2e-playwright-ir-data"),
] as const;

async function makeRemovable(path: string): Promise<void> {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata || !metadata.isDirectory() || metadata.isSymbolicLink()) return;
  await chmod(path, 0o700);
  const entries = await readdir(path, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => makeRemovable(resolve(path, entry.name))),
  );
}

async function removeE2eDirectory(path: string): Promise<void> {
  if (dirname(path) !== cacheRoot) {
    throw new Error("Refusing to clean a non-E2E data root");
  }
  await makeRemovable(path);
  await rm(path, { force: true, recursive: true });
}

await Promise.all(e2eDirectories.map(removeE2eDirectory));
