import { chmod, lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { createStorageLayout, type StorageLayout } from "@/storage/layout";

export interface TemporaryDataRoot {
  readonly cleanup: () => Promise<void>;
  readonly layout: StorageLayout;
  readonly path: string;
}

const prefix = "mirawind-test-";

async function makeDirectoriesRemovable(path: string): Promise<void> {
  const metadata = await lstat(path).catch(() => undefined);
  if (!metadata || !metadata.isDirectory() || metadata.isSymbolicLink()) return;
  await chmod(path, 0o700);
  const entries = await readdir(path);
  await Promise.all(
    entries.map((entry) => makeDirectoriesRemovable(resolve(path, entry))),
  );
}

export async function createTemporaryDataRoot(
  label = "runtime",
): Promise<TemporaryDataRoot> {
  const safeLabel = label.replaceAll(/[^a-z0-9-]/gi, "-").slice(0, 40);
  const path = await mkdtemp(
    join(tmpdir(), `${prefix}${safeLabel || "runtime"}-`),
  );
  await chmod(path, 0o700);
  const canonicalPath = await realpath(path);
  const layout = await createStorageLayout(canonicalPath);
  let cleaned = false;

  return Object.freeze({
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      const resolved = resolve(canonicalPath);
      if (
        dirname(resolved) !== resolve(tmpdir()) ||
        !basename(resolved).startsWith(prefix)
      ) {
        throw new Error("Refusing to remove an unowned test data root");
      }
      await makeDirectoriesRemovable(resolved);
      await rm(resolved, { force: true, recursive: true });
    },
    layout,
    path: canonicalPath,
  });
}
