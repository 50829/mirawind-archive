import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildZip } from "../../../scripts/fixtures/zip-builder";

const mockedInspection = vi.hoisted(() => ({ archivePath: "" }));

vi.mock(
  "@/modules/publishing/adapters/filesystem/inspect-zip",
  async (load) => {
    const actual =
      await load<
        typeof import("@/modules/publishing/adapters/filesystem/inspect-zip")
      >();
    return {
      ...actual,
      inspectZipFile: (
        path: string,
        options: Parameters<typeof actual.inspectZipFile>[1],
      ) => actual.inspectZipFile(mockedInspection.archivePath || path, options),
    };
  },
);

const { extractZipFile } =
  await import("@/modules/publishing/adapters/filesystem/extract-archive");

const roots: string[] = [];

afterEach(async () => {
  mockedInspection.archivePath = "";
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("archive inspection/extraction identity", () => {
  it("rejects a different second-pass entry set and removes its destination", async () => {
    const root = await mkdtemp(join(tmpdir(), "archive-identity-"));
    roots.push(root);
    const archivePath = join(root, "actual.zip");
    const inspectedPath = join(root, "inspected.zip");
    const destination = join(root, "extracted");
    await writeFile(
      archivePath,
      buildZip({ entries: [{ data: "actual", name: "book/actual.md" }] }),
    );
    await writeFile(
      inspectedPath,
      buildZip({ entries: [{ data: "second", name: "book/other.md" }] }),
    );
    mockedInspection.archivePath = inspectedPath;

    await expect(
      extractZipFile({ archivePath, destination }),
    ).rejects.toThrow();
    await expect(access(destination)).rejects.toThrow();
  });
});
