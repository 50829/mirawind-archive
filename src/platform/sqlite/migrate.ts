import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type Database from "better-sqlite3";

export interface Migration {
  readonly baselineIdentity?: string;
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

export class DatabaseBaselineIncompatibleError extends Error {
  readonly code = "DATABASE_BASELINE_INCOMPATIBLE";

  constructor() {
    super("The database belongs to an incompatible Mirawind baseline.");
    this.name = "DatabaseBaselineIncompatibleError";
  }
}

export function checksumMigration(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export function applyMigrations(
  database: Database.Database,
  migrations: readonly Migration[],
): { readonly applied: readonly number[]; readonly current: number } {
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

  const baseline = ordered.find((migration) => migration.baselineIdentity);
  const schemaMigrationExists =
    (
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM sqlite_master
           WHERE type = 'table' AND name = 'schema_migrations'`,
        )
        .get() as { count: number }
    ).count === 1;
  let existing: { version: number; checksum: string }[] = [];

  if (baseline) {
    if (ordered.length !== 1 || baseline.version !== 1) {
      throw new DatabaseBaselineIncompatibleError();
    }
    const userTables = database
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as { name: string }[];
    if (!schemaMigrationExists && userTables.length > 0) {
      throw new DatabaseBaselineIncompatibleError();
    }
    if (schemaMigrationExists) {
      existing = database
        .prepare(
          "SELECT version, checksum FROM schema_migrations ORDER BY version",
        )
        .all() as { version: number; checksum: string }[];
      const isNewBaseline =
        existing.length === 1 &&
        existing[0]?.version === baseline.version &&
        existing[0]?.checksum === baseline.checksum;
      const isEmptyDatabase =
        existing.length === 0 &&
        userTables.every((table) => table.name === "schema_migrations");
      if (!isNewBaseline && !isEmptyDatabase) {
        throw new DatabaseBaselineIncompatibleError();
      }
      if (isNewBaseline) {
        if (!userTables.some((table) => table.name === "database_baseline")) {
          throw new DatabaseBaselineIncompatibleError();
        }
        const marker = database
          .prepare(
            `SELECT identity
             FROM database_baseline
             WHERE id = 1`,
          )
          .get() as { identity: string } | undefined;
        if (marker?.identity !== baseline.baselineIdentity) {
          throw new DatabaseBaselineIncompatibleError();
        }
      }
    }
  } else if (schemaMigrationExists) {
    existing = database
      .prepare(
        "SELECT version, checksum FROM schema_migrations ORDER BY version",
      )
      .all() as { version: number; checksum: string }[];
  }

  if (!schemaMigrationExists) {
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL CHECK(length(checksum) = 64),
        applied_at INTEGER NOT NULL
      ) STRICT
    `);
  }

  for (const applied of existing) {
    const expected = ordered.find(
      (migration) => migration.version === applied.version,
    );
    if (!expected || expected.checksum !== applied.checksum) {
      if (baseline) throw new DatabaseBaselineIncompatibleError();
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

export async function withSchemaLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  const lock = await open(
    lockPath,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await lock.writeFile(`${process.pid}\n`);
    await lock.sync();
    return await operation();
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
