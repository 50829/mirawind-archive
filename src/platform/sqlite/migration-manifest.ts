import { readFile } from "node:fs/promises";

import {
  checksumMigration,
  MigrationChecksumError,
  type Migration,
} from "@/platform/sqlite/migrate";

const migrationDefinitions = [
  {
    baselineIdentity: "mirawind-clean-slate-maintenance-v1",
    checksum:
      "787819cd9b312af5376b5bc8cabf2757db2655ac3059322b916730b9cc163413",
    file: "0001_clean_slate.sql",
    name: "clean_slate_maintenance",
    version: 1,
  },
] as const;

export async function loadMigrationManifest(): Promise<readonly Migration[]> {
  return Promise.all(
    migrationDefinitions.map(async (definition) => {
      const sql = await readFile(
        new URL(`./migrations/${definition.file}`, import.meta.url),
        "utf8",
      );
      if (checksumMigration(sql) !== definition.checksum) {
        throw new MigrationChecksumError(definition.version);
      }
      return Object.freeze({
        baselineIdentity: definition.baselineIdentity,
        checksum: definition.checksum,
        name: definition.name,
        sql,
        version: definition.version,
      });
    }),
  );
}
