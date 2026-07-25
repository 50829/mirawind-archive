import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destinations = [
  resolve(repositoryRoot, "dist", "server", "schemas"),
  resolve(repositoryRoot, "dist", "docs", "schemas"),
];
const schemaNames = [
  "book.v1.schema.json",
  "book.schema.json",
  "document-manifest.schema.json",
  "version.schema.json",
];

await Promise.all(
  destinations.flatMap((destination) =>
    schemaNames.map(async (schemaName) => {
      await mkdir(destination, { recursive: true });
      await copyFile(
        resolve(repositoryRoot, "docs", "schemas", schemaName),
        resolve(destination, schemaName),
      );
    }),
  ),
);

const migrationDestination = resolve(
  repositoryRoot,
  "dist",
  "processes",
  "db",
  "migrations",
);
await mkdir(migrationDestination, { recursive: true });
await Promise.all(
  [
    "0001_m1_core.sql",
    "0002_better_auth.sql",
    "0003_passkey_last_used.sql",
    "0004_job_idempotency.sql",
    "0005_version_reclamation.sql",
    "0006_book_version_presentations.sql",
    "0007_permanent_book_deletion.sql",
  ].map((migrationName) =>
    copyFile(
      resolve(repositoryRoot, "src", "db", "migrations", migrationName),
      resolve(migrationDestination, migrationName),
    ),
  ),
);
