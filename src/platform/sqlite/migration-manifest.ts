import { readFile } from "node:fs/promises";

import {
  checksumMigration,
  MigrationChecksumError,
  type Migration,
} from "@/platform/sqlite/migrate";

const migrationDefinitions = [
  {
    baselineIdentity: "mirawind-publishing-editor-v1",
    checksum:
      "c9bb475ecdf69efafed5ea904711c660ae5125c7c0786bc543526435e932ae89",
    file: "0001_clean_slate.sql",
    name: "publishing_editor_clean_slate",
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
