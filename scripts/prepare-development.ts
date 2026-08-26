import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { bootstrapAdministrator, createSetupAuth } from "@/composition/cli";
import { parseEnvironment } from "@/config/environment";
import { createStorageLayout } from "@/platform/filesystem/storage-layout";
import { openDatabase } from "@/platform/sqlite/connection";
import { loadMigrationManifest } from "@/platform/sqlite/migration-manifest";
import { applyMigrations } from "@/platform/sqlite/migrate";

const environment = parseEnvironment(process.env, { mode: "development" });
const layout = await createStorageLayout(environment.dataDirectory);
const database = openDatabase(
  join(layout.databaseDirectory, "mirawind.sqlite"),
  {
    role: "worker",
  },
);

try {
  applyMigrations(database, await loadMigrationManifest());
  const installation = database
    .prepare("SELECT admin_user_id FROM installation WHERE id = 1")
    .get() as { readonly admin_user_id: string | null } | undefined;
  if (!installation?.admin_user_id) {
    await bootstrapAdministrator({
      auth: createSetupAuth({ database, environment }),
      database,
      displayName: "Local Developer",
      email: "local-developer@localhost.invalid",
      nowMs: Date.now(),
      password: randomBytes(48).toString("base64url"),
    });
  }
} finally {
  database.close();
}
