import { readFile } from "node:fs/promises";

import {
  checksumMigration,
  MigrationChecksumError,
  type Migration,
} from "./migrate.js";

const migrationDefinitions = [
  {
    checksum:
      "22168380aa61446124de8d7166a29deb03426956b2d300b98916abd7bd99686d",
    file: "0001_m1_core.sql",
    name: "m1_core",
    version: 1,
  },
  {
    checksum:
      "3fd4d3264984c7e1156d6ccc10b302c04c0f8388b684e87f755d51843f8dcb2f",
    file: "0002_better_auth.sql",
    name: "better_auth",
    version: 2,
  },
  {
    checksum:
      "97defe21c9d481ccdb25f54172b2240631d17e8d158da2da68bed52a5835594b",
    file: "0003_passkey_last_used.sql",
    name: "passkey_last_used",
    version: 3,
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
        checksum: definition.checksum,
        name: definition.name,
        sql,
        version: definition.version,
      });
    }),
  );
}
