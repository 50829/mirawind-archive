import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseRealFixtureManifest,
  verifyRealMineruFixtures,
} from "../../../scripts/fixtures/verify-real-mineru";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function fixture(id: string, content: string) {
  return {
    file_name: `${id}.zip`,
    id,
    mineru_version: "3.4.4",
    page_count_range: { maximum: 600, minimum: 200 },
    sha256: createHash("sha256").update(content).digest("hex"),
    size_bytes: Buffer.byteLength(content),
    usage_scope: {
      designated_by: "administrator",
      local_compatibility_testing: true,
      local_performance_testing: true,
      public_ci: false,
      redistribution: false,
      repository_storage: false,
    },
  };
}

describe("real MinerU fixture verifier", () => {
  it("accepts registered local-only files with matching hashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "real-mineru-verifier-"));
    roots.push(root);
    const contents = [
      "first opaque bytes",
      "second opaque bytes",
      "third opaque bytes",
    ];
    const fixtures = [
      fixture("real-mineru-a7f31c", contents[0] ?? ""),
      fixture("real-mineru-b9d204", contents[1] ?? ""),
      fixture("real-mineru-c3e591", contents[2] ?? ""),
    ];
    await Promise.all(
      fixtures.map((entry, index) =>
        writeFile(join(root, entry.file_name), contents[index] ?? ""),
      ),
    );
    await writeFile(
      join(root, "real-fixtures.json"),
      JSON.stringify({ fixtures, schema_version: 1 }),
    );

    await expect(verifyRealMineruFixtures(root)).resolves.toEqual([
      expect.objectContaining({
        fileName: "real-mineru-a7f31c.zip",
        id: "real-mineru-a7f31c",
        sizeBytes: Buffer.byteLength(contents[0] ?? ""),
      }),
      expect.objectContaining({ id: "real-mineru-b9d204" }),
      expect.objectContaining({ id: "real-mineru-c3e591" }),
    ]);
  });

  it("rejects altered bytes, symlinks and expanded usage scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "real-mineru-verifier-"));
    roots.push(root);
    const first = fixture("real-mineru-a7f31c", "expected");
    const second = fixture("real-mineru-b9d204", "second");
    const third = fixture("real-mineru-c3e591", "third");
    await writeFile(join(root, first.file_name), "altered!");
    await writeFile(join(root, second.file_name), "second");
    await writeFile(join(root, third.file_name), "third");
    await writeFile(
      join(root, "real-fixtures.json"),
      JSON.stringify({ fixtures: [first, second, third], schema_version: 1 }),
    );
    await expect(verifyRealMineruFixtures(root)).rejects.toThrow(
      /SHA-256 does not match/,
    );

    await writeFile(join(root, first.file_name), "expected");
    await writeFile(join(root, "outside.zip"), "second");
    await rm(join(root, second.file_name));
    await symlink(join(root, "outside.zip"), join(root, second.file_name));
    await expect(verifyRealMineruFixtures(root)).rejects.toThrow(/non-symlink/);

    await expect(
      Promise.resolve().then(() =>
        parseRealFixtureManifest({
          fixtures: [
            first,
            {
              ...second,
              usage_scope: { ...second.usage_scope, public_ci: true },
            },
            third,
          ],
          schema_version: 1,
        }),
      ),
    ).rejects.toThrow(/approved local-only scope/);
  });

  it("rejects missing, unknown and duplicate manifest fields", () => {
    const first = fixture("real-mineru-a7f31c", "first");
    const second = fixture("real-mineru-b9d204", "second");
    const third = fixture("real-mineru-c3e591", "third");
    expect(() =>
      parseRealFixtureManifest({
        fixtures: [{ ...first, title: "must not be recorded" }, second, third],
        schema_version: 1,
      }),
    ).toThrow(/unexpected fields/);
    expect(() =>
      parseRealFixtureManifest({
        fixtures: [first, first, third],
        schema_version: 1,
      }),
    ).toThrow(/must be unique/);
    expect(() =>
      parseRealFixtureManifest({
        fixtures: [],
        schema_version: 1,
      }),
    ).toThrow(/between one and 100 approved entries/);
    expect(
      parseRealFixtureManifest({
        fixtures: [first],
        schema_version: 1,
      }).fixtures,
    ).toHaveLength(1);
  });

  it("rejects fixtures produced by a different MinerU version", () => {
    const first = fixture("real-mineru-a7f31c", "first");
    const second = fixture("real-mineru-b9d204", "second");
    const third = fixture("real-mineru-c3e591", "third");
    expect(() =>
      parseRealFixtureManifest({
        fixtures: [{ ...first, mineru_version: "3.4.3" }, second, third],
        schema_version: 1,
      }),
    ).toThrow(/must be 3\.4\.4/);
  });
});
