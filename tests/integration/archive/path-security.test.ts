import { describe, expect, it } from "vitest";

import {
  ArchivePathRegistry,
  normalizeArchiveEntryPath,
} from "@/modules/publishing/core/preparation/archive-path-policy";

function errorCode(callback: () => unknown): string {
  try {
    callback();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      return error.code;
    }
    throw error;
  }
  throw new Error("Expected callback to reject");
}

describe("archive entry path policy", () => {
  it.each([
    ["", "ARCHIVE_PATH_EMPTY"],
    [".", "ARCHIVE_PATH_EMPTY"],
    ["./", "ARCHIVE_PATH_EMPTY"],
    ["/book.md", "ARCHIVE_PATH_ABSOLUTE"],
    ["C:/book.md", "ARCHIVE_PATH_ABSOLUTE"],
    ["c:\\book.md", "ARCHIVE_PATH_ABSOLUTE"],
    ["//server/share/book.md", "ARCHIVE_PATH_ABSOLUTE"],
    ["\\\\server\\share\\book.md", "ARCHIVE_PATH_ABSOLUTE"],
    ["../book.md", "ARCHIVE_PATH_TRAVERSAL"],
    ["wrapper/../../book.md", "ARCHIVE_PATH_TRAVERSAL"],
    ["wrapper\\..\\book.md", "ARCHIVE_PATH_TRAVERSAL"],
    ["book\u0000.md", "ARCHIVE_PATH_NUL"],
  ])("rejects hostile path %j", (path, code) => {
    expect(errorCode(() => normalizeArchiveEntryPath(path))).toBe(code);
  });

  it("decodes strict UTF-8 and normalizes Windows, dot and NFC forms", () => {
    expect(
      normalizeArchiveEntryPath(
        Buffer.from("wrapper\\.\\cafe\u0301\\full.md", "utf8"),
      ),
    ).toMatchObject({
      directoryDepth: 2,
      isDirectory: false,
      normalizedPath: "wrapper/café/full.md",
    });
    expect(
      errorCode(() => normalizeArchiveEntryPath(Uint8Array.from([0xc3, 0x28]))),
    ).toBe("ARCHIVE_PATH_INVALID_UTF8");
  });

  it("enforces normalized component, path and directory-depth byte limits", () => {
    expect(
      errorCode(() => normalizeArchiveEntryPath(`${"é".repeat(128)}.md`)),
    ).toBe("ARCHIVE_COMPONENT_LIMIT");
    expect(
      errorCode(() =>
        normalizeArchiveEntryPath(
          `${Array.from({ length: 9 }, (_, index) => `${index}${"a".repeat(228)}`).join("/")}/book.md`,
        ),
      ),
    ).toBe("ARCHIVE_PATH_LIMIT");
    expect(
      errorCode(() =>
        normalizeArchiveEntryPath(
          `${Array.from({ length: 21 }, (_, index) => `d${index}`).join("/")}/book.md`,
        ),
      ),
    ).toBe("ARCHIVE_DEPTH_LIMIT");
    expect(
      normalizeArchiveEntryPath(
        `${Array.from({ length: 20 }, (_, index) => `d${index}`).join("/")}/book.md`,
      ).directoryDepth,
    ).toBe(20);
  });

  it("detects duplicates, NFC collisions and file-directory prefix conflicts", () => {
    const duplicate = new ArchivePathRegistry();
    duplicate.add("book/full.md");
    expect(errorCode(() => duplicate.add("book//./full.md"))).toBe(
      "ARCHIVE_PATH_COLLISION",
    );

    const unicode = new ArchivePathRegistry();
    unicode.add("book/café.md");
    expect(errorCode(() => unicode.add("book/cafe\u0301.md"))).toBe(
      "ARCHIVE_PATH_COLLISION",
    );

    const fileFirst = new ArchivePathRegistry();
    fileFirst.add("book");
    expect(errorCode(() => fileFirst.add("book/full.md"))).toBe(
      "ARCHIVE_PATH_PREFIX_CONFLICT",
    );

    const childFirst = new ArchivePathRegistry();
    childFirst.add("book/full.md");
    expect(errorCode(() => childFirst.add("book"))).toBe(
      "ARCHIVE_PATH_PREFIX_CONFLICT",
    );

    const explicitDirectory = new ArchivePathRegistry();
    explicitDirectory.add("book/");
    explicitDirectory.add("book/full.md");
    expect(explicitDirectory.entries()).toHaveLength(2);
  });
});
