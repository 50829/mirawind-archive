import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { BlobReader, ZipReader } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { buildHostileZipFixtures } from "../../../scripts/fixtures/build-hostile-zips";
import { buildStressBook } from "../../../scripts/fixtures/build-stress-book";
import { buildZip, crc32 } from "../../../scripts/fixtures/zip-builder";
import { createTemporaryDataRoot } from "../../helpers/data-root";

async function entryNames(bytes: Buffer): Promise<readonly string[]> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const reader = new ZipReader(new BlobReader(new Blob([copy])));
  try {
    return (await reader.getEntries()).map((entry) => entry.filename);
  } finally {
    await reader.close();
  }
}

describe("deterministic generated archives", () => {
  it("builds a standards-readable ZIP with stable bytes and CRC", async () => {
    const input = Buffer.from("deterministic");
    const first = buildZip({
      entries: [{ data: input, method: 8, name: "book/full.md" }],
    });
    const second = buildZip({
      entries: [{ data: input, method: 8, name: "book/full.md" }],
    });

    expect(first).toEqual(second);
    expect(crc32(input)).toBe(0x6f4500fc);
    expect(await entryNames(first)).toEqual(["book/full.md"]);
  });

  it("builds a repeatable bounded several-hundred-page stress book", async () => {
    const options = { blocksPerPage: 3, imageCount: 4, pages: 300 };
    const first = buildStressBook(options);
    const second = buildStressBook(options);

    expect(first.metadata).toEqual(second.metadata);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.metadata.pages).toBe(300);
    expect(await entryNames(first.bytes)).toEqual(
      expect.arrayContaining([
        "stress-result/full.md",
        "stress-result/content_list.json",
        "stress-result/layout.json",
        "stress-result/images/image-003.svg",
      ]),
    );
    expect(() =>
      buildStressBook({ blocksPerPage: 1, imageCount: 0, pages: 2_001 }),
    ).toThrow(/pages/);
  });

  it("writes the complete hostile matrix with reproducible manifests", async () => {
    const firstRoot = await createTemporaryDataRoot("hostile-first");
    const secondRoot = await createTemporaryDataRoot("hostile-second");
    try {
      const first = await buildHostileZipFixtures(firstRoot.path);
      const second = await buildHostileZipFixtures(secondRoot.path);
      expect(first.length).toBe(20);
      expect(first).toEqual(second);
      expect(first.map((entry) => entry.expected_category)).toEqual(
        expect.arrayContaining([
          "accepted-control",
          "archive-path",
          "archive-special-file",
          "archive-expansion-ratio",
          "archive-entry-limit",
        ]),
      );
      const control = await readFile(
        `${firstRoot.path}/${first[0]?.file_name ?? ""}`,
      );
      expect(createHash("sha256").update(control).digest("hex")).toBe(
        first[0]?.sha256,
      );
      expect(await entryNames(control)).toEqual(["book/full.md"]);
    } finally {
      await firstRoot.cleanup();
      await secondRoot.cleanup();
    }
  }, 30_000);
});
