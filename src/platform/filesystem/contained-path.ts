import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

export async function resolveContainedPath(
  rootInput: string,
  relativePath: string,
): Promise<string> {
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    hasControlCharacters(relativePath) ||
    /^[A-Za-z]:/u.test(relativePath) ||
    relativePath.normalize("NFC") !== relativePath
  ) {
    throw new Error("Path must be a canonical non-empty POSIX relative path");
  }
  const components = relativePath.split("/");
  if (
    components.some(
      (component) =>
        component.length === 0 || component === "." || component === "..",
    )
  ) {
    throw new Error("Path contains a non-canonical component");
  }
  const root = resolve(rootInput);
  const target = resolve(root, relativePath);
  const relation = relative(root, target);
  if (
    relation.length === 0 ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error("Path escapes or aliases the storage root");
  }
  return target;
}

export async function verifyContainedParent(
  rootInput: string,
  targetInput: string,
): Promise<void> {
  const root = resolve(rootInput);
  const parent = dirname(resolve(targetInput));
  const [canonicalRoot, canonicalParent] = await Promise.all([
    realpath(root),
    realpath(parent),
  ]);
  const relation = relative(canonicalRoot, canonicalParent);
  if (
    canonicalRoot !== root ||
    canonicalParent !== parent ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error("Path parent escapes or aliases the storage root");
  }
}
