import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  archiveResourceLimits,
  extractZipFile,
} from "@/modules/publishing/adapters/filesystem/extract-archive";
import { buildZip } from "../../../scripts/fixtures/zip-builder";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function fixture(bytes: Buffer): Promise<{
  readonly archivePath: string;
  readonly destination: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "archive-limits-"));
  roots.push(root);
  const archivePath = join(root, "input.zip");
  await writeFile(archivePath, bytes);
  return { archivePath, destination: join(root, "extracted") };
}

async function doesNotExist(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}

function code(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

describe("actual streaming archive limits", () => {
  it("locks the approved production byte, ratio and duration ceilings", () => {
    expect(archiveResourceLimits).toEqual({
      entryBytes: 2 * 1024 * 1024 * 1024,
      expansionRatio: 200,
      expansionRatioThresholdBytes: 64 * 1024 * 1024,
      taskDurationMs: 30 * 60 * 1_000,
      totalBytes: 8 * 1024 * 1024 * 1024,
      uploadBytes: 2 * 1024 * 1024 * 1024,
    });
  });

  it("streams accepted bytes into exclusive contained files", async () => {
    const input = await fixture(
      buildZip({
        entries: [
          { data: "markdown", method: 8, name: "book/full.md" },
          { data: "image", name: "book/images/a.bin" },
        ],
      }),
    );
    const result = await extractZipFile(input);

    expect(result).toMatchObject({
      entries: 2,
      files: 2,
      totalUncompressedBytes: 13,
    });
    expect(
      await readFile(join(input.destination, "book/full.md"), "utf8"),
    ).toBe("markdown");
  });

  it.each([
    {
      code: "ARCHIVE_ENTRY_SIZE_LIMIT",
      entries: [{ data: "12345", name: "book/full.md" }],
      limits: { entryBytes: 4 },
    },
    {
      code: "ARCHIVE_TOTAL_SIZE_LIMIT",
      entries: [
        { data: "1234", name: "book/first.md" },
        { data: "5678", name: "book/second.md" },
      ],
      limits: { totalBytes: 7 },
    },
  ])(
    "enforces $code from actual output and removes staging",
    async (example) => {
      const input = await fixture(buildZip({ entries: example.entries }));
      await expect(
        extractZipFile({ ...input, limits: example.limits }),
      ).rejects.toSatisfy((error: unknown) => code(error) === example.code);
      expect(await doesNotExist(input.destination)).toBe(true);
    },
  );

  it("applies the ratio only above the threshold to entries and package", async () => {
    const atThreshold = await fixture(
      buildZip({
        entries: [{ data: "A".repeat(10), method: 8, name: "book/full.md" }],
      }),
    );
    await expect(
      extractZipFile({
        ...atThreshold,
        limits: {
          expansionRatio: 1,
          expansionRatioThresholdBytes: 10,
        },
      }),
    ).resolves.toMatchObject({ totalUncompressedBytes: 10 });

    const entryBomb = await fixture(
      buildZip({
        entries: [{ data: "A".repeat(20), method: 8, name: "book/full.md" }],
      }),
    );
    await expect(
      extractZipFile({
        ...entryBomb,
        limits: {
          expansionRatio: 2,
          expansionRatioThresholdBytes: 10,
        },
      }),
    ).rejects.toSatisfy(
      (error: unknown) => code(error) === "ARCHIVE_EXPANSION_RATIO_LIMIT",
    );
    expect(await doesNotExist(entryBomb.destination)).toBe(true);

    const packageBomb = await fixture(
      buildZip({
        entries: [
          { data: "A".repeat(8), method: 8, name: "book/a.md" },
          { data: "A".repeat(8), method: 8, name: "book/b.md" },
        ],
      }),
    );
    await expect(
      extractZipFile({
        ...packageBomb,
        limits: {
          expansionRatio: 1,
          expansionRatioThresholdBytes: 10,
        },
      }),
    ).rejects.toSatisfy(
      (error: unknown) => code(error) === "ARCHIVE_EXPANSION_RATIO_LIMIT",
    );
  });

  it("honors cancellation and timeout while removing the destination", async () => {
    const canceled = await fixture(
      buildZip({ entries: [{ data: "body", name: "book/full.md" }] }),
    );
    await expect(
      extractZipFile({
        ...canceled,
        signal: AbortSignal.abort("test cancellation"),
      }),
    ).rejects.toSatisfy((error: unknown) => code(error) === "ARCHIVE_CANCELED");
    expect(await doesNotExist(canceled.destination)).toBe(true);

    const timedOut = await fixture(
      buildZip({ entries: [{ data: "body", name: "book/full.md" }] }),
    );
    let current = 0;
    await expect(
      extractZipFile({
        ...timedOut,
        limits: { taskDurationMs: 1 },
        now: () => current++,
      }),
    ).rejects.toSatisfy((error: unknown) => code(error) === "ARCHIVE_TIMEOUT");
    expect(await doesNotExist(timedOut.destination)).toBe(true);
  });

  it("rejects more than 20,000 entries before creating output", async () => {
    const input = await fixture(
      buildZip({
        entries: Array.from({ length: 20_001 }, (_, index) => ({
          name: `entry/${index}`,
        })),
      }),
    );
    await expect(extractZipFile(input)).rejects.toSatisfy(
      (error: unknown) => code(error) === "ARCHIVE_ENTRY_LIMIT",
    );
    expect(await doesNotExist(input.destination)).toBe(true);
  });
});
