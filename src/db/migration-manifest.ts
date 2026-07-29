import { readFile } from "node:fs/promises";

import {
  checksumMigration,
  MigrationChecksumError,
  type Migration,
} from "@/db/migrate";

const migrationDefinitions = [
  {
    baselineIdentity: "mirawind-clean-slate-publishing-v1",
    checksum:
      "2ed4d872d017d444ff1aa353ead836f62fe47ec2a3a58496e5584734d17072b5",
    file: "0001_clean_slate.sql",
    name: "clean_slate_publishing",
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
