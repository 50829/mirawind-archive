import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  MigrationChecksumError,
  applyMigrations,
  checksumMigration,
  type Migration,
} from "@/db/migrate";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function openTemporaryDatabase(): Promise<Database.Database> {
  const root = await mkdtemp(join(tmpdir(), "mirawind-migrations-"));
  temporaryRoots.push(root);
  return new Database(join(root, "database.sqlite"));
}

const migrations: readonly Migration[] = [
  {
    checksum: checksumMigration(
      "CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT NOT NULL);",
    ),
    name: "core",
    sql: "CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT NOT NULL);",
    version: 1,
  },
  {
    checksum: checksumMigration(
      "ALTER TABLE books ADD COLUMN visibility TEXT NOT NULL DEFAULT 'draft';",
    ),
    name: "visibility",
    sql: "ALTER TABLE books ADD COLUMN visibility TEXT NOT NULL DEFAULT 'draft';",
    version: 2,
  },
];

describe("checksummed migrations", () => {
  it("upgrades an old fixture exactly once and preserves its row", async () => {
    const database = await openTemporaryDatabase();
    applyMigrations(database, migrations.slice(0, 1));
    database.prepare("INSERT INTO books (title) VALUES (?)").run("Fixture");

    expect(applyMigrations(database, migrations)).toEqual({
      applied: [2],
      current: 2,
    });
    expect(database.prepare("SELECT * FROM books").get()).toMatchObject({
      title: "Fixture",
      visibility: "draft",
    });
    expect(applyMigrations(database, migrations)).toEqual({
      applied: [],
      current: 2,
    });
    database.close();
  });

  it("rejects edited migration history before applying later SQL", async () => {
    const database = await openTemporaryDatabase();
    applyMigrations(database, migrations.slice(0, 1));

    const firstMigration = migrations[0];
    const secondMigration = migrations[1];
    if (!firstMigration || !secondMigration) {
      throw new Error("Expected two migration fixtures");
    }
    const edited: readonly Migration[] = [
      { ...firstMigration, checksum: "0".repeat(64) },
      secondMigration,
    ];
    expect(() => applyMigrations(database, edited)).toThrow(
      MigrationChecksumError,
    );
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM pragma_table_info('books') WHERE name = 'visibility'",
        )
        .get(),
    ).toEqual({ count: 0 });
    database.close();
  });
});
