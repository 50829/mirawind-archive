import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Atomic file parent must be a non-symlink directory");
  }
  if ((await realpath(path)) !== resolve(path)) {
    throw new Error("Atomic file parent cannot contain a symbolic link");
  }
  const handle = await open(
    path,
    constants.O_RDONLY |
      (constants.O_DIRECTORY ?? 0) |
      (constants.O_NOFOLLOW ?? 0),
  );
  try {
    await handle.chmod(0o700);
  } finally {
    await handle.close();
  }
}

export function openExclusiveFile(path: string): Promise<FileHandle> {
  return open(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(
    path,
    constants.O_RDONLY |
      (constants.O_DIRECTORY ?? 0) |
      (constants.O_NOFOLLOW ?? 0),
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function atomicWriteFile(
  target: string,
  content: string | Uint8Array,
  options: { readonly mode: number },
): Promise<void> {
  const parent = dirname(target);
  await ensurePrivateDirectory(parent);
  const temporary = resolve(
    parent,
    `.${basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let handle: FileHandle | undefined;
  let renamed = false;
  try {
    handle = await openExclusiveFile(temporary);
    await handle.writeFile(content);
    await handle.chmod(options.mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    renamed = true;
    await syncDirectory(parent);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (!renamed) await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
