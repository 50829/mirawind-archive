import type Database from "better-sqlite3";

import { deleteFinalPasskey } from "@/modules/identity/adapters/sqlite/final-passkey";
import { InstallationRepository } from "@/modules/identity/adapters/sqlite/installation";

export function createIdentityServer(database: Database.Database) {
  const installation = new InstallationRepository(database);
  return Object.freeze({
    adminUserId: installation.adminUserId.bind(installation),
    deleteFinalPasskey: (
      input: Omit<Parameters<typeof deleteFinalPasskey>[0], "database">,
    ) => deleteFinalPasskey({ ...input, database }),
  });
}
