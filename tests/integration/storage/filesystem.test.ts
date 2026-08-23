import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageLayout } from "@/platform/filesystem/storage-layout";
import { resolveContainedPath } from "@/platform/filesystem/contained-path";
import {
  atomicWriteFile,
  openExclusiveFile,
} from "@/platform/filesystem/atomic-file";
import { openVerifiedContainedFile } from "@/platform/filesystem/verified-file";

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

  it.each([
    "nested/./file",
    "nested//file",
    "nested/../file",
    "C:relative",
    "nested/control\u0001file",
  ])("rejects a non-canonical internal path: %s", async (candidate) => {
    await expect(
      resolveContainedPath(await temporaryRoot(), candidate),
    ).rejects.toThrow();
  });

  it("rejects symlink storage roots and managed directories", async () => {
    const parent = await temporaryRoot();
    const target = join(parent, "target");
    await mkdir(target);
    const linkedRoot = join(parent, "linked-root");
    await symlink(target, linkedRoot);
    await expect(createStorageLayout(linkedRoot)).rejects.toThrow();

    const root = await temporaryRoot();
    const external = await temporaryRoot();
    await symlink(external, join(root, "db"));
    await expect(createStorageLayout(root)).rejects.toThrow();
  });

  it("writes atomically and does not leave the temporary representation", async () => {
    const root = await temporaryRoot();
    const target = join(root, "book.yaml");
    await atomicWriteFile(target, "revision: 1\n", { mode: 0o600 });
    await atomicWriteFile(target, "revision: 2\n", { mode: 0o600 });
    expect(await readFile(target, "utf8")).toBe("revision: 2\n");
  });

  it("removes the temporary sibling when replacement fails", async () => {
    const root = await temporaryRoot();
    const target = join(root, "book.yaml");
    await mkdir(target);
    await writeFile(join(target, "preserved"), "old");

    await expect(
      atomicWriteFile(target, "revision: 2\n", { mode: 0o600 }),
    ).rejects.toThrow();

    expect(await readFile(join(target, "preserved"), "utf8")).toBe("old");
    expect(await readdir(root)).toEqual(["book.yaml"]);
  });

  it("rejects reads and writes through a symlinked parent", async () => {
    const root = await temporaryRoot();
    const external = await temporaryRoot();
    const nested = join(external, "nested");
    await mkdir(nested);
    await writeFile(join(nested, "private.txt"), "private");
    await symlink(external, join(root, "linked"));

    let readRejected = false;
    try {
      const handle = await openVerifiedContainedFile({
        expectedSize: 7,
        relativePath: "linked/nested/private.txt",
        root,
      });
      await handle.close();
    } catch {
      readRejected = true;
    }
    expect(readRejected).toBe(true);
    await expect(
      atomicWriteFile(join(root, "linked", "nested", "created.txt"), "bad", {
        mode: 0o600,
      }),
    ).rejects.toThrow();
    await expect(
      readFile(join(nested, "created.txt"), "utf8"),
    ).rejects.toThrow();
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
