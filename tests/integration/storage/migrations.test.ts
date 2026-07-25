import { access, mkdtemp, rm } from "node:fs/promises";
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
import { loadMigrationManifest } from "@/db/migration-manifest";
import { runDatabaseMigrations } from "@/cli/commands/db-migrate";

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

  it("applies the locked M1 schema with FTS5 and all authority tables", async () => {
    const database = await openTemporaryDatabase();
    const result = applyMigrations(database, await loadMigrationManifest());
    expect(result).toEqual({ applied: [1, 2, 3, 4, 5, 6], current: 6 });

    const names = (
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "installation",
        "books",
        "source_snapshots",
        "config_revisions",
        "draft_previews",
        "original_files",
        "imports",
        "import_candidates",
        "book_versions",
        "book_version_presentations",
        "jobs",
        "search_short_fields",
        "search_fts",
        "audit_events",
        "user",
        "session",
        "account",
        "verification",
        "passkey",
        "rateLimit",
        "job_idempotency_keys",
      ]),
    );
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'passkey_usage'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM pragma_table_info('book_versions')
           WHERE name = 'reclaimed_at'`,
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM pragma_table_info('book_version_presentations')
           WHERE name IN (
             'projection_schema_version',
             'projection_sha256',
             'toc_preview_json'
           )`,
        )
        .get(),
    ).toEqual({ count: 3 });
    database.close();
  });

  it("upgrades a v5 database without changing existing book lineage", async () => {
    const database = await openTemporaryDatabase();
    const manifest = await loadMigrationManifest();
    applyMigrations(database, manifest.slice(0, 5));
    database
      .prepare(
        `INSERT INTO installation (
          id, admin_user_id, schema_version, created_at, updated_at
        ) VALUES (1, NULL, 1, 1000, 1000)`,
      )
      .run();

    expect(applyMigrations(database, manifest)).toEqual({
      applied: [6],
      current: 6,
    });
    expect(
      database.prepare("SELECT * FROM installation WHERE id = 1").get(),
    ).toMatchObject({ created_at: 1000, id: 1, updated_at: 1000 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM book_version_presentations")
        .get(),
    ).toEqual({ count: 0 });
    expect(applyMigrations(database, manifest)).toEqual({
      applied: [],
      current: 6,
    });
    database.close();
  });

  it("takes a restorable pre-migration backup under an exclusive schema lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirawind-migration-runner-"));
    temporaryRoots.push(root);
    const databasePath = join(root, "db", "mirawind.sqlite");
    const backupDirectory = join(root, "backups");

    expect(
      await runDatabaseMigrations({
        backupDirectory,
        databasePath,
        nowMs: 1_000,
      }),
    ).toMatchObject({
      applied: [1, 2, 3, 4, 5, 6],
      backupPath: null,
      current: 6,
    });
    const second = await runDatabaseMigrations({
      backupDirectory,
      databasePath,
      nowMs: 2_000,
    });
    expect(second).toMatchObject({ applied: [], current: 6 });
    expect(second.backupPath).not.toBeNull();
    if (!second.backupPath) throw new Error("Expected a pre-migration backup");
    await access(second.backupPath);

    const backup = new Database(second.backupPath);
    expect(
      backup
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'books'",
        )
        .get(),
    ).toEqual({ count: 1 });
    backup.close();
  });

  it("enforces the ten-Passkey ceiling inside SQLite", async () => {
    const database = await openTemporaryDatabase();
    applyMigrations(database, await loadMigrationManifest());
    database
      .prepare(
        `INSERT INTO "user"
          (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("admin", "Admin", "admin@example.test", 1, Date.now(), Date.now());
    const insert = database.prepare(
      `INSERT INTO passkey
        (id, publicKey, userId, credentialID, counter, deviceType, backedUp)
       VALUES (?, ?, ?, ?, 0, 'singleDevice', 0)`,
    );
    for (let index = 0; index < 10; index += 1) {
      insert.run(
        `passkey-${index}`,
        `public-key-${index}`,
        "admin",
        `credential-${index}`,
      );
    }
    expect(() =>
      insert.run("passkey-10", "public-key-10", "admin", "credential-10"),
    ).toThrow(/PASSKEY_LIMIT_EXCEEDED/);
    database.close();
  });
});
