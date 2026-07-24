import { resolve } from "node:path";

import { runDatabaseMigrations } from "./commands/db-migrate.js";

const usage = `Usage:
  pnpm db:migrate
  pnpm mirawind admin bootstrap --data-dir <absolute-path>
  pnpm mirawind admin recover --data-dir <absolute-path>
`;

const [group, command] = process.argv.slice(2);

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
} else if (group !== "admin" || !["bootstrap", "recover"].includes(command)) {
  process.stderr.write(`Unsupported command.\n${usage}`);
  process.exitCode = 2;
} else {
  process.stderr.write(
    `ADMIN_${command.toUpperCase()}_NOT_IMPLEMENTED: complete the foundational authentication tasks first.\n`,
  );
  process.exitCode = 3;
}
