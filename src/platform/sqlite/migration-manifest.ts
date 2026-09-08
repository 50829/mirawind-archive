import { readFile } from "node:fs/promises";

import {
  checksumMigration,
  MigrationChecksumError,
  type Migration,
} from "./migrate";

export const databaseBaselineIdentity = "mirawind-content-ir-v1";

const migrationDefinitions = [
  {
    baselineIdentity: databaseBaselineIdentity,
    checksum:
      "08f1f680cf342e9076192beee177fd10bbab07a95212d0c481e67e8b09c66157",
    file: "0001_clean_slate.sql",
    name: "content_ir_clean_slate",
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
