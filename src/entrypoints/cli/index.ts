import { resolve } from "node:path";

import type Database from "better-sqlite3";

import {
  bootstrapAdministrator,
  createSetupAuth,
  recoverAdministrator,
} from "@/composition/cli";
import { runAdminCli } from "./admin-cli";
import { runDatabaseMigrations } from "./commands/db-migrate";
import { promptForAdministrator } from "./prompt";
import { parseEnvironment } from "@/config/environment";
import { openDatabase } from "@/platform/sqlite/connection";
import { loadMigrationManifest } from "@/platform/sqlite/migration-manifest";
import {
  acquireMaintenanceLock,
  serviceIsRunning,
} from "@/platform/filesystem/maintenance-lock";

const usage = `Usage:
  pnpm db:migrate
  pnpm mirawind admin bootstrap --data-dir <absolute-path>
  pnpm mirawind admin recover --data-dir <absolute-path>
`;

const [group, command] = process.argv.slice(2);

async function assertMigrationsCurrent(
  database: Database.Database,
): Promise<void> {
  const expected = await loadMigrationManifest();
  const actual = database
    .prepare("SELECT version, checksum FROM schema_migrations ORDER BY version")
    .all() as { version: number; checksum: string }[];
  if (
    actual.length !== expected.length ||
    expected.some(
      (migration, index) =>
        actual[index]?.version !== migration.version ||
        actual[index]?.checksum !== migration.checksum,
    )
  ) {
    throw new Error("DATABASE_MIGRATIONS_NOT_CURRENT");
  }
}

async function withOfflineAdminContext(
  dataDirectory: string,
  operation: (input: {
    readonly auth: ReturnType<typeof createSetupAuth>;
    readonly database: Database.Database;
  }) => Promise<void>,
): Promise<void> {
  const lock = await acquireMaintenanceLock(dataDirectory);
  let database: Database.Database | undefined;
  try {
    const environment = parseEnvironment(
      { ...process.env, MIRAWIND_DATA_DIR: dataDirectory },
      {
        mode:
          process.env.NODE_ENV === "production" ? "production" : "development",
      },
    );
    database = openDatabase(resolve(dataDirectory, "db", "mirawind.sqlite"), {
      role: "worker",
    });
    await assertMigrationsCurrent(database);
    await operation({
      auth: createSetupAuth({ database, environment }),
      database,
    });
  } finally {
    database?.close();
    await lock.release();
  }
}

if (group === undefined || command === undefined) {
  process.stderr.write(usage);
  process.exitCode = 2;
} else if (group === "db" && command === "migrate") {
  const dataDirectory = process.env.MIRAWIND_DATA_DIR;
  if (!dataDirectory?.startsWith("/")) {
    process.stderr.write("INVALID_DATA_DIRECTORY\n");
    process.exitCode = 2;
  } else {
    try {
      const result = await runDatabaseMigrations({
        backupDirectory: resolve(dataDirectory, "backups"),
        databasePath: resolve(dataDirectory, "db", "mirawind.sqlite"),
      });
      process.stdout.write(
        `Schema ${result.current}; applied ${result.applied.join(",") || "none"}\n`,
      );
    } catch {
      process.stderr.write("DATABASE_MIGRATION_FAILED\n");
      process.exitCode = 5;
    }
  }
} else if (group === "admin" && ["bootstrap", "recover"].includes(command)) {
  process.exitCode = await runAdminCli(process.argv.slice(2), {
    async bootstrap(input) {
      await withOfflineAdminContext(input.dataDirectory, async (context) => {
        const result = await bootstrapAdministrator({
          ...context,
          displayName: input.displayName ?? "",
          email: input.email ?? "",
          nowMs: Date.now(),
          password: input.password,
        });
        process.stdout.write(`Administrator ${result.userId} initialized.\n`);
      });
    },
    input: process.stdin,
    output: process.stderr,
    prompt: promptForAdministrator,
    async recover(input) {
      await withOfflineAdminContext(input.dataDirectory, async (context) => {
        const result = await recoverAdministrator({
          ...context,
          nowMs: Date.now(),
          password: input.password,
        });
        process.stdout.write(
          `Administrator ${result.userId} recovered; ${result.revokedSessions} sessions revoked and ${result.deletedPasskeys} Passkeys deleted.\n`,
        );
      });
    },
    serviceIsRunning,
  });
} else if (group !== "admin" || !["bootstrap", "recover"].includes(command)) {
  process.stderr.write(`Unsupported command.\n${usage}`);
  process.exitCode = 2;
}
