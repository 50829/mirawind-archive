import {
  constants,
  mkdir,
  open,
  rename,
  stat,
  type FileHandle,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

export interface StorageLayout {
  readonly bookDirectory: string;
  readonly databaseDirectory: string;
  readonly root: string;
  readonly temporaryDirectory: string;
  readonly uploadDirectory: string;
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.chmod(0o700);
  } finally {
    await handle.close();
  }
}

export async function createStorageLayout(
  rootInput: string,
): Promise<StorageLayout> {
  if (!isAbsolute(rootInput)) {
    throw new Error("Storage root must be absolute");
  }
  const root = resolve(rootInput);
  if (root === sep) {
    throw new Error("Filesystem root cannot be the storage root");
  }

  const databaseDirectory = resolve(root, "db");
  const bookDirectory = resolve(root, "books");
  const temporaryDirectory = resolve(root, "tmp");
  const uploadDirectory = resolve(temporaryDirectory, "uploads");
  await Promise.all([
    privateDirectory(databaseDirectory),
    privateDirectory(bookDirectory),
    privateDirectory(uploadDirectory),
  ]);

  const devices = await Promise.all(
    [root, bookDirectory, uploadDirectory].map(
      async (path) => (await stat(path)).dev,
    ),
  );
  if (new Set(devices).size !== 1) {
    throw new Error(
      "Storage staging and version paths must share a filesystem",
    );
  }

  return Object.freeze({
    bookDirectory,
    databaseDirectory,
    root,
    temporaryDirectory,
    uploadDirectory,
  });
}

export async function resolveContainedPath(
  rootInput: string,
  relativePath: string,
): Promise<string> {
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.includes("\0")
  ) {
    throw new Error("Path must be a non-empty POSIX relative path");
  }
  const root = resolve(rootInput);
  const target = resolve(root, relativePath);
  const relation = relative(root, target);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error("Path escapes the storage root");
  }
  return target;
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
  const handle = await open(path, constants.O_RDONLY);
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
  await privateDirectory(dirname(target));
  const temporary = resolve(
    dirname(target),
    `.${basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const handle = await openExclusiveFile(temporary);
  try {
    await handle.writeFile(content);
    await handle.chmod(options.mode);
    await handle.sync();
  } catch (error) {
    await handle.close();
    throw error;
  }
  await handle.close();
  await rename(temporary, target);
  await syncDirectory(dirname(target));
}
