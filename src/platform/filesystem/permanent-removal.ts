import { chmod, lstat, readdir, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export class UnsafePermanentRemovalTargetError extends Error {
  readonly code: "CLEANUP_TARGET_OUTSIDE_ROOT" | "CLEANUP_UNSAFE_TARGET";

  constructor(
    code: UnsafePermanentRemovalTargetError["code"],
    message: string,
  ) {
    super(message);
    this.name = "UnsafePermanentRemovalTargetError";
    this.code = code;
  }
}

function contained(root: string, target: string): boolean {
  const relation = relative(root, target);
  return (
    relation.length > 0 &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

async function unlockDirectories(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return;
  await chmod(path, 0o700);
  const entries = await readdir(path);
  await Promise.all(
    entries.map((entry) => unlockDirectories(resolve(path, entry))),
  );
}

export async function removeExactContainedTree(input: {
  readonly root: string;
  readonly target: string;
}): Promise<void> {
  const root = resolve(input.root);
  const target = resolve(input.target);
  if (root === sep || !contained(root, target)) {
    throw new UnsafePermanentRemovalTargetError(
      target === root ? "CLEANUP_UNSAFE_TARGET" : "CLEANUP_TARGET_OUTSIDE_ROOT",
      "The cleanup target is not a safe contained path.",
    );
  }
  const metadata = await lstat(target).catch((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  });
  if (!metadata) return;
  if (metadata.isSymbolicLink()) {
    throw new UnsafePermanentRemovalTargetError(
      "CLEANUP_UNSAFE_TARGET",
      "A cleanup target cannot be a symbolic link.",
    );
  }
  await unlockDirectories(target);
  await rm(target, { force: true, recursive: true });
  const remaining = await lstat(target).catch((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  });
  if (remaining) throw new Error("CLEANUP_FILESYSTEM_IO");
}
