import { lstat, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  atomicWriteFile,
  createStorageLayout,
  openExclusiveFile,
  resolveContainedPath,
} from "@/platform/filesystem/layout";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirawind-storage-"));
  temporaryRoots.push(root);
  return root;
}

describe("persistent filesystem boundary", () => {
  it("creates the approved private same-root layout", async () => {
    const root = await temporaryRoot();
    const layout = await createStorageLayout(root);
    expect(layout.databaseDirectory).toBe(join(root, "db"));
    expect(layout.uploadDirectory).toBe(join(root, "tmp", "uploads"));
    expect((await lstat(layout.uploadDirectory)).mode & 0o077).toBe(0);
  });

  it.each(["../escape", "/absolute", "nested/../../escape", "C:\\escape"])(
    "rejects a path outside the root: %s",
    async (candidate) => {
      await expect(
        resolveContainedPath(await temporaryRoot(), candidate),
      ).rejects.toThrow();
    },
  );

  it("writes atomically and does not leave the temporary representation", async () => {
    const root = await temporaryRoot();
    const target = join(root, "book.yaml");
    await atomicWriteFile(target, "revision: 1\n", { mode: 0o600 });
    await atomicWriteFile(target, "revision: 2\n", { mode: 0o600 });
    expect(await readFile(target, "utf8")).toBe("revision: 2\n");
  });

  it("uses exclusive no-follow creation", async () => {
    const root = await temporaryRoot();
    const target = join(root, "upload.part");
    const first = await openExclusiveFile(target);
    await first.close();
    await expect(openExclusiveFile(target)).rejects.toMatchObject({
      code: "EEXIST",
    });

    const link = join(root, "linked.part");
    await symlink(target, link);
    await expect(openExclusiveFile(link)).rejects.toThrow();
  });
});
