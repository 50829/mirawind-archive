import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

export interface StorageLayout {
  readonly bookDirectory: string;
  readonly databaseDirectory: string;
  readonly root: string;
  readonly temporaryDirectory: string;
  readonly uploadDirectory: string;
}

async function privateDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Managed storage path must be a non-symlink directory");
  }
  const handle = await open(
    path,
    constants.O_RDONLY |
      (constants.O_DIRECTORY ?? 0) |
      (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (!opened.isDirectory()) {
      throw new Error("Managed storage path must be a directory");
    }
    await handle.chmod(0o700);
  } finally {
    await handle.close();
  }
  return realpath(path);
}

export async function createStorageLayout(
  rootInput: string,
): Promise<StorageLayout> {
  if (!isAbsolute(rootInput)) {
    throw new Error("Storage root must be absolute");
  }
  const requestedRoot = resolve(rootInput);
  if (requestedRoot === sep) {
    throw new Error("Filesystem root cannot be the storage root");
  }
  const root = await privateDirectory(requestedRoot);
  if (root === sep) {
    throw new Error("Filesystem root cannot be the storage root");
  }

  const [databaseDirectory, bookDirectory, temporaryDirectory] =
    await Promise.all([
      privateDirectory(resolve(root, "db")),
      privateDirectory(resolve(root, "books")),
      privateDirectory(resolve(root, "tmp")),
    ]);
  const uploadDirectory = await privateDirectory(
    resolve(temporaryDirectory, "uploads"),
  );

  const devices = await Promise.all(
    [
      root,
      databaseDirectory,
      bookDirectory,
      temporaryDirectory,
      uploadDirectory,
    ].map(async (path) => (await stat(path)).dev),
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
