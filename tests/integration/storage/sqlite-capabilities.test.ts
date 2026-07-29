import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertDatabaseCapabilities,
  openDatabase,
} from "@/platform/sqlite/connection";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirawind-sqlite-"));
  temporaryRoots.push(root);
  return join(root, "mirawind.sqlite");
}

describe("SQLite runtime capabilities", () => {
  it("opens a Web connection with the approved durability and busy policy", async () => {
    const database = openDatabase(await databasePath(), { role: "web" });

    expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("trusted_schema", { simple: true })).toBe(0);
    expect(database.pragma("synchronous", { simple: true })).toBe(2);
    expect(database.pragma("busy_timeout", { simple: true })).toBe(250);
    expect(database.pragma("wal_autocheckpoint", { simple: true })).toBe(0);
    database.close();
  });

  it("uses the longer worker busy bound without changing durability", async () => {
    const database = openDatabase(await databasePath(), { role: "worker" });
    expect(database.pragma("busy_timeout", { simple: true })).toBe(5_000);
    expect(database.pragma("synchronous", { simple: true })).toBe(2);
    database.close();
  });

  it("proves the linked SQLite floor, WAL, FTS5, and trigram queries", async () => {
    const database = openDatabase(await databasePath(), { role: "web" });
    expect(assertDatabaseCapabilities(database)).toMatchObject({
      fts5: true,
      journalMode: "wal",
      minimumVersion: "3.51.3",
      trigram: true,
    });
    database.close();
  });
});
