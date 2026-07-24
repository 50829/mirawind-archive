import { describe, expect, it } from "vitest";

import { inspectZipBytes } from "@/compiler/archive/zip-reader";
import { buildZip } from "../../../scripts/fixtures/zip-builder";

function code(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

async function rejectsWith(
  input: Uint8Array,
  expectedCode: string,
): Promise<void> {
  await expect(inspectZipBytes(input)).rejects.toSatisfy(
    (error: unknown) => code(error) === expectedCode,
  );
}

function centralOffsets(bytes: Buffer): number[] {
  const offsets: number[] = [];
  for (let index = 0; index <= bytes.length - 4; index += 1) {
    if (bytes.readUInt32LE(index) === 0x02014b50) offsets.push(index);
  }
  return offsets;
}

describe("strict ZIP format inspection", () => {
  it("accepts only unencrypted store/deflate regular files with valid CRC", async () => {
    const archive = buildZip({
      entries: [
        { data: "stored", method: 0, name: "book/stored.md" },
        { data: "deflated", method: 8, name: "book/deflated.md" },
      ],
    });
    const inspected = await inspectZipBytes(archive);

    expect(
      inspected.entries.map((entry) => ({
        method: entry.compressionMethod,
        path: entry.path.normalizedPath,
      })),
    ).toEqual([
      { method: 0, path: "book/stored.md" },
      { method: 8, path: "book/deflated.md" },
    ]);
  });

  it("rejects truncated headers and local/central ambiguity", async () => {
    const valid = buildZip({
      entries: [{ data: "body", name: "book/full.md" }],
    });
    await rejectsWith(
      valid.subarray(0, valid.length - 12),
      "ARCHIVE_MALFORMED",
    );
    await rejectsWith(
      buildZip({
        entries: [
          {
            centralName: "book/other.md",
            data: "body",
            name: "book/full.md",
          },
        ],
      }),
      "ARCHIVE_AMBIGUOUS",
    );
  });

  it("rejects overlapping entry ranges before decompression", async () => {
    const archive = buildZip({
      entries: [
        { data: "a", name: "first.md" },
        { data: "b", name: "second.md" },
      ],
    });
    const central = centralOffsets(archive);
    expect(central).toHaveLength(2);
    const firstCentral = central[0];
    if (firstCentral === undefined) throw new Error("Missing central record");
    archive.writeUInt32LE(11, 18);
    archive.writeUInt32LE(11, 22);
    archive.writeUInt32LE(11, firstCentral + 20);
    archive.writeUInt32LE(11, firstCentral + 24);

    await rejectsWith(archive, "ARCHIVE_OVERLAP");
  });

  it("rejects entry bytes that fail the central CRC", async () => {
    const archive = buildZip({
      entries: [{ data: "body", name: "book/full.md" }],
    });
    const nameLength = archive.readUInt16LE(26);
    archive[30 + nameLength] = 0x78;
    await rejectsWith(archive, "ARCHIVE_CRC_MISMATCH");
  });

  it.each([
    [
      "encryption",
      buildZip({
        entries: [{ data: "body", flags: 1, name: "book/full.md" }],
      }),
      "ARCHIVE_ENCRYPTED",
    ],
    [
      "multi-disk",
      buildZip({
        centralDirectoryDisk: 1,
        entries: [{ data: "body", name: "book/full.md" }],
        eocdDisk: 1,
      }),
      "ARCHIVE_MULTI_DISK",
    ],
    [
      "unsupported compression",
      buildZip({
        entries: [{ data: "body", method: 99, name: "book/full.md" }],
      }),
      "ARCHIVE_COMPRESSION_UNSUPPORTED",
    ],
    [
      "Unix symlink",
      buildZip({
        entries: [
          {
            data: "../outside",
            externalAttributes: (0o120777 << 16) >>> 0,
            name: "book/link",
          },
        ],
      }),
      "ARCHIVE_SPECIAL_FILE",
    ],
    [
      "Unix FIFO",
      buildZip({
        entries: [
          {
            externalAttributes: (0o010644 << 16) >>> 0,
            name: "book/pipe",
          },
        ],
      }),
      "ARCHIVE_SPECIAL_FILE",
    ],
  ])("rejects %s archives", async (_label, archive, expectedCode) => {
    await rejectsWith(archive as Buffer, expectedCode as string);
  });
});
