import Database from "better-sqlite3";
import { databaseBaselineIdentity } from "./migration-manifest";
import { DatabaseBaselineIncompatibleError } from "./migrate";

const minimumSqliteVersion = "3.51.3";

export interface DatabaseCapabilities {
  readonly fts5: true;
  readonly journalMode: "wal";
  readonly linkedVersion: string;
  readonly minimumVersion: typeof minimumSqliteVersion;
  readonly trigram: true;
}

function versionTuple(version: string): readonly number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = versionTuple(actual);
  const right = versionTuple(minimum);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

export function openDatabase(
  path: string,
  options: { readonly role: "web" | "worker" },
): Database.Database {
  const database = new Database(path);
  const marker = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='database_baseline'",
    )
    .get();
  const library = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='books'",
    )
    .get();
  if (
    (marker &&
      (
        database
          .prepare("SELECT identity FROM database_baseline WHERE id=1")
          .get() as { identity: string } | undefined
      )?.identity !== databaseBaselineIdentity) ||
    (library && !marker)
  ) {
    database.close();
    throw new DatabaseBaselineIncompatibleError();
  }
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("trusted_schema = OFF");
  database.pragma("synchronous = FULL");
  database.pragma("wal_autocheckpoint = 0");
  database.pragma(`busy_timeout = ${options.role === "web" ? 250 : 5_000}`);
  return database;
}

export function assertDatabaseCapabilities(
  database: Database.Database,
): DatabaseCapabilities {
  const linkedVersion = database
    .prepare("SELECT sqlite_version() AS version")
    .get() as { version: string };
  if (!versionAtLeast(linkedVersion.version, minimumSqliteVersion)) {
    throw new Error(`SQLite ${minimumSqliteVersion} or newer is required`);
  }
  if (database.pragma("journal_mode", { simple: true }) !== "wal") {
    throw new Error("SQLite WAL mode is required");
  }

  database.exec(
    "CREATE VIRTUAL TABLE temp.mirawind_trigram_test USING fts5(value, tokenize='trigram', detail=full)",
  );
  try {
    database
      .prepare("INSERT INTO temp.mirawind_trigram_test(value) VALUES (?)")
      .run("中文搜索验证");
    const result = database
      .prepare(
        "SELECT COUNT(*) AS count FROM temp.mirawind_trigram_test WHERE value MATCH ?",
      )
      .get('"中文搜索"') as { count: number };
    if (result.count !== 1) {
      throw new Error("SQLite FTS5 trigram smoke test failed");
    }
  } finally {
    database.exec("DROP TABLE temp.mirawind_trigram_test");
  }

  return {
    fts5: true,
    journalMode: "wal",
    linkedVersion: linkedVersion.version,
    minimumVersion: minimumSqliteVersion,
    trigram: true,
  };
}
