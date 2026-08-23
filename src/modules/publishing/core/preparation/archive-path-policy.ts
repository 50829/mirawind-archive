import { SafeApplicationError } from "@/domain/errors";
import { hasControlCharacters } from "@/domain/text";

const archivePathLimits = Object.freeze({
  componentBytes: 255,
  directoryDepth: 20,
  pathBytes: 2_048,
});

export interface NormalizedArchiveEntryPath {
  readonly collisionKey: string;
  readonly components: readonly string[];
  readonly directoryDepth: number;
  readonly isDirectory: boolean;
  readonly normalizedPath: string;
  readonly pathBytes: number;
}

type ArchivePathErrorCode =
  | "ARCHIVE_COMPONENT_LIMIT"
  | "ARCHIVE_PATH_CONTROL"
  | "ARCHIVE_DEPTH_LIMIT"
  | "ARCHIVE_PATH_ABSOLUTE"
  | "ARCHIVE_PATH_COLLISION"
  | "ARCHIVE_PATH_EMPTY"
  | "ARCHIVE_PATH_INVALID_UTF8"
  | "ARCHIVE_PATH_LIMIT"
  | "ARCHIVE_PATH_NUL"
  | "ARCHIVE_PATH_PREFIX_CONFLICT"
  | "ARCHIVE_PATH_TRAVERSAL";

class ArchivePathError extends SafeApplicationError {
  constructor(code: ArchivePathErrorCode, message: string) {
    super(code, message, 400);
    this.name = "ArchivePathError";
  }
}

function decodeName(input: string | Uint8Array): string {
  if (typeof input === "string") return input;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new ArchivePathError(
      "ARCHIVE_PATH_INVALID_UTF8",
      "An archive entry name is not valid UTF-8.",
    );
  }
}

function fail(code: ArchivePathErrorCode, message: string): never {
  throw new ArchivePathError(code, message);
}

function caseFold(value: string): string {
  return value.normalize("NFKC").toUpperCase().toLowerCase().normalize("NFC");
}

export function normalizeArchiveEntryPath(
  input: string | Uint8Array,
): NormalizedArchiveEntryPath {
  const decoded = decodeName(input);
  if (decoded.includes("\0")) {
    fail("ARCHIVE_PATH_NUL", "An archive entry path contains a NUL byte.");
  }
  if (hasControlCharacters(decoded)) {
    fail(
      "ARCHIVE_PATH_CONTROL",
      "An archive entry path contains a control character.",
    );
  }
  if (!decoded || decoded === "." || decoded === "./") {
    fail("ARCHIVE_PATH_EMPTY", "An archive entry path is empty.");
  }
  const withPosixSeparators = decoded.replaceAll("\\", "/");
  if (
    withPosixSeparators.startsWith("/") ||
    /^[A-Za-z]:/u.test(withPosixSeparators)
  ) {
    fail("ARCHIVE_PATH_ABSOLUTE", "An archive entry path is absolute.");
  }

  const isDirectory = withPosixSeparators.endsWith("/");
  const components: string[] = [];
  for (const rawComponent of withPosixSeparators.split("/")) {
    if (!rawComponent || rawComponent === ".") continue;
    if (rawComponent === "..") {
      fail(
        "ARCHIVE_PATH_TRAVERSAL",
        "An archive entry path traverses its extraction root.",
      );
    }
    const component = rawComponent.normalize("NFC");
    if (
      Buffer.byteLength(component, "utf8") > archivePathLimits.componentBytes
    ) {
      fail(
        "ARCHIVE_COMPONENT_LIMIT",
        "An archive entry path component exceeds the byte limit.",
      );
    }
    components.push(component);
  }
  if (components.length === 0) {
    fail("ARCHIVE_PATH_EMPTY", "An archive entry path is empty.");
  }

  const normalizedPath = components.join("/");
  const collisionKey = caseFold(normalizedPath);
  const pathBytes = Buffer.byteLength(normalizedPath, "utf8");
  if (pathBytes > archivePathLimits.pathBytes) {
    fail("ARCHIVE_PATH_LIMIT", "An archive entry path exceeds the byte limit.");
  }
  const directoryDepth = isDirectory
    ? components.length
    : Math.max(0, components.length - 1);
  if (directoryDepth > archivePathLimits.directoryDepth) {
    fail(
      "ARCHIVE_DEPTH_LIMIT",
      "An archive entry path exceeds the directory depth limit.",
    );
  }

  return Object.freeze({
    collisionKey,
    components: Object.freeze(components),
    directoryDepth,
    isDirectory,
    normalizedPath,
    pathBytes,
  });
}

export class ArchivePathRegistry {
  readonly #entries = new Map<string, NormalizedArchiveEntryPath>();
  readonly #types = new Map<string, "directory" | "file">();

  add(input: string | Uint8Array): NormalizedArchiveEntryPath {
    const entry = normalizeArchiveEntryPath(input);
    const type = entry.isDirectory ? "directory" : "file";
    if (this.#entries.has(entry.collisionKey)) {
      fail(
        "ARCHIVE_PATH_COLLISION",
        "Archive entries collide after path normalization.",
      );
    }

    const collisionComponents = entry.components.map(caseFold);
    for (let index = 1; index < collisionComponents.length; index += 1) {
      const prefix = collisionComponents.slice(0, index).join("/");
      if (this.#types.get(prefix) === "file") {
        fail(
          "ARCHIVE_PATH_PREFIX_CONFLICT",
          "An archive file conflicts with a directory path.",
        );
      }
    }
    if (
      type === "file" &&
      this.#types.get(entry.collisionKey) === "directory"
    ) {
      fail(
        "ARCHIVE_PATH_PREFIX_CONFLICT",
        "An archive file conflicts with a directory path.",
      );
    }

    this.#entries.set(entry.collisionKey, entry);
    this.#types.set(entry.collisionKey, type);
    for (let index = 1; index < collisionComponents.length; index += 1) {
      const prefix = collisionComponents.slice(0, index).join("/");
      if (!this.#types.has(prefix)) this.#types.set(prefix, "directory");
    }
    return entry;
  }

  entries(): readonly NormalizedArchiveEntryPath[] {
    return Object.freeze([...this.#entries.values()]);
  }
}
