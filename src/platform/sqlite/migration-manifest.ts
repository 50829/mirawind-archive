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
      "419f227261f5e27d15df2c202de2d77cc3b85fc2c07b406648c5a470b013b59c",
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
