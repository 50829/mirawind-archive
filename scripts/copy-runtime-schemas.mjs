import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(repositoryRoot, "dist", "server", "schemas");
const schemaNames = ["book.schema.json", "document-manifest.schema.json"];

await mkdir(destination, { recursive: true });

await Promise.all(
  schemaNames.map((schemaName) =>
    copyFile(
      resolve(repositoryRoot, "docs", "schemas", schemaName),
      resolve(destination, schemaName),
    ),
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
await copyFile(
  resolve(repositoryRoot, "src", "db", "migrations", "0001_m1_core.sql"),
  resolve(migrationDestination, "0001_m1_core.sql"),
);
