import { join } from "node:path";

import type Database from "better-sqlite3";

import { openDatabase } from "@/db/connection";
import { applyMigrations } from "@/db/migrate";
import { loadMigrationManifest } from "@/db/migration-manifest";

import type { TemporaryDataRoot } from "./data-root";

export interface MigratedTestDatabase {
  readonly close: () => void;
  readonly database: Database.Database;
  readonly path: string;
  readonly schemaVersion: number;
}

export async function openMigratedTestDatabase(
  dataRoot: TemporaryDataRoot,
  role: "web" | "worker" = "worker",
): Promise<MigratedTestDatabase> {
  const path = join(dataRoot.layout.databaseDirectory, "mirawind.sqlite");
  const database = openDatabase(path, { role });
  try {
    const migration = applyMigrations(database, await loadMigrationManifest());
    let closed = false;
    return Object.freeze({
      close() {
        if (closed) return;
        closed = true;
        database.close();
      },
      database,
      path,
      schemaVersion: migration.current,
    });
  } catch (error) {
    database.close();
    throw error;
  }
}

export async function withMigratedTestDatabase<T>(
  callback: (
    database: MigratedTestDatabase,
    dataRoot: TemporaryDataRoot,
  ) => Promise<T> | T,
): Promise<T> {
  const { createTemporaryDataRoot } = await import("./data-root.js");
  const dataRoot = await createTemporaryDataRoot("database");
  let database: MigratedTestDatabase | undefined;
  try {
    database = await openMigratedTestDatabase(dataRoot);
    return await callback(database, dataRoot);
  } finally {
    database?.close();
    await dataRoot.cleanup();
  }
}
