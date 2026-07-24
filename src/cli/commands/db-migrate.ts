import { access, mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { openDatabase } from "../../db/connection.js";
import { loadMigrationManifest } from "../../db/migration-manifest.js";
import { applyMigrations, withSchemaLock } from "../../db/migrate.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface MigrationRunResult {
  readonly applied: readonly number[];
  readonly backupPath: string | null;
  readonly current: number;
}

export async function runDatabaseMigrations(input: {
  readonly backupDirectory: string;
  readonly databasePath: string;
  readonly nowMs?: number;
}): Promise<MigrationRunResult> {
  const databaseExisted = await exists(input.databasePath);
  await mkdir(dirname(input.databasePath), { recursive: true, mode: 0o700 });

  return withSchemaLock(`${input.databasePath}.schema.lock`, async () => {
    const database = openDatabase(input.databasePath, { role: "worker" });
    try {
      let backupPath: string | null = null;
      if (databaseExisted) {
        await mkdir(input.backupDirectory, { recursive: true, mode: 0o700 });
        backupPath = join(
          input.backupDirectory,
          `${basename(input.databasePath)}.${input.nowMs ?? Date.now()}.backup`,
        );
        await database.backup(backupPath);
      }
      const result = applyMigrations(database, await loadMigrationManifest());
      return { ...result, backupPath };
    } finally {
      database.close();
    }
  });
}
