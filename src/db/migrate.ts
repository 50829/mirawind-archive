import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

export interface Migration {
  readonly checksum: string;
  readonly name: string;
  readonly sql: string;
  readonly version: number;
}

export class MigrationChecksumError extends Error {
  constructor(version: number) {
    super(`Migration ${version} checksum does not match immutable history`);
    this.name = "MigrationChecksumError";
  }
}

export function checksumMigration(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export function applyMigrations(
  database: Database.Database,
  migrations: readonly Migration[],
): { readonly applied: readonly number[]; readonly current: number } {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL CHECK(length(checksum) = 64),
      applied_at INTEGER NOT NULL
    ) STRICT
  `);

  const ordered = [...migrations].sort(
    (left, right) => left.version - right.version,
  );
  const seen = new Set<number>();
  for (const migration of ordered) {
    if (
      !Number.isSafeInteger(migration.version) ||
      migration.version < 1 ||
      seen.has(migration.version) ||
      checksumMigration(migration.sql) !== migration.checksum
    ) {
      throw new MigrationChecksumError(migration.version);
    }
    seen.add(migration.version);
  }

  const existing = database
    .prepare("SELECT version, checksum FROM schema_migrations ORDER BY version")
    .all() as { version: number; checksum: string }[];
  for (const applied of existing) {
    const expected = ordered.find(
      (migration) => migration.version === applied.version,
    );
    if (!expected || expected.checksum !== applied.checksum) {
      throw new MigrationChecksumError(applied.version);
    }
  }

  const applied: number[] = [];
  const applyOne = database.transaction((migration: Migration) => {
    database.exec(migration.sql);
    database
      .prepare(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      )
      .run(migration.version, migration.name, migration.checksum, Date.now());
  });
  for (const migration of ordered) {
    if (!existing.some((item) => item.version === migration.version)) {
      applyOne.immediate(migration);
      applied.push(migration.version);
    }
  }
  return { applied, current: ordered.at(-1)?.version ?? 0 };
}
