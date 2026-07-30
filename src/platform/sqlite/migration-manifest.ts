import { readFile } from "node:fs/promises";

import {
  checksumMigration,
  MigrationChecksumError,
  type Migration,
} from "@/platform/sqlite/migrate";

const migrationDefinitions = [
  {
    baselineIdentity: "mirawind-clean-slate-candidate-v1",
    checksum:
      "cd11599d898638b9727d9c0ab4863362707effc8675f808faceca286ca604967",
    file: "0001_clean_slate.sql",
    name: "clean_slate_candidate",
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
