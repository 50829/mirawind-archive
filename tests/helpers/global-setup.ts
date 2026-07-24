import { chmod, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createSetupAuth } from "@/auth/setup-server";
import { bootstrapAdministrator } from "@/cli/commands/admin-bootstrap";
import { openDatabase } from "@/db/connection";
import { applyMigrations } from "@/db/migrate";
import { loadMigrationManifest } from "@/db/migration-manifest";
import { createStorageLayout } from "@/storage/layout";

import { buildZip } from "../../scripts/fixtures/zip-builder.js";
import { startWorkerProcess } from "./processes.js";

export const e2eAdministrator = Object.freeze({
  email: "admin@example.test",
  password: "e2e-only-password-0123456789",
});
export const e2eDataRoot = resolve(".cache/e2e-playwright-data");
export const e2eFixtureRoot = resolve(".cache/e2e-fixtures");
export const e2eOrigin = "http://127.0.0.1:4321";
export const e2eHighMarkdown = [
  "# E2E Cloud Book",
  "",
  "A durable source paragraph.",
  "",
  "## First chapter",
  "",
  "The preview is compiled in the worker.",
].join("\n");

export async function ensureTestDataRoot(
  relativePath = "test-results/runtime-data",
): Promise<string> {
  const dataRoot = resolve(relativePath);
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  return dataRoot;
}

async function removeLockedE2eTree(path: string): Promise<void> {
  const expectedParent = resolve(".cache");
  if (dirname(path) !== expectedParent) {
    throw new Error("Refusing to clean a non-E2E data root");
  }
  const metadata = await lstat(path).catch(() => null);
  if (!metadata) return;
  const unlock = async (directory: string): Promise<void> => {
    await chmod(directory, 0o700);
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => unlock(resolve(directory, entry.name))),
    );
  };
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    await unlock(path);
  }
  await rm(path, { force: true, recursive: true });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await removeLockedE2eTree(e2eDataRoot);
  await removeLockedE2eTree(e2eFixtureRoot);
  const layout = await createStorageLayout(e2eDataRoot);
  await mkdir(e2eFixtureRoot, { mode: 0o700, recursive: true });
  const database = openDatabase(
    resolve(layout.databaseDirectory, "mirawind.sqlite"),
    { role: "worker" },
  );
  try {
    applyMigrations(database, await loadMigrationManifest());
    await bootstrapAdministrator({
      auth: createSetupAuth({
        database,
        environment: {
          allowedHosts: ["127.0.0.1", "localhost"],
          authSecret: "test-only-secret-0123456789-abcdef",
          dataDirectory: e2eDataRoot,
          passkeyRpId: "127.0.0.1",
          publicOrigin: e2eOrigin,
        },
      }),
      database,
      displayName: "Administrator",
      email: e2eAdministrator.email,
      nowMs: Date.now(),
      password: e2eAdministrator.password,
    });
  } finally {
    database.close();
  }

  await Promise.all([
    writeFile(
      resolve(e2eFixtureRoot, "high-confidence.zip"),
      buildZip({
        entries: [
          { data: e2eHighMarkdown, name: "wrapper/result/full.md" },
          { data: '{"pages":[]}', name: "wrapper/result/layout.json" },
        ],
      }),
    ),
    writeFile(
      resolve(e2eFixtureRoot, "generic.zip"),
      buildZip({
        entries: [
          {
            data: "# E2E Generic Book\n\nConfirm this candidate.",
            name: "notes.md",
          },
        ],
      }),
    ),
    writeFile(
      resolve(e2eFixtureRoot, "ambiguous.zip"),
      buildZip({
        entries: [
          { data: "# First Candidate\n\nFirst body.", name: "first.md" },
          { data: "# Second Candidate\n\nSecond body.", name: "second.md" },
        ],
      }),
    ),
  ]);

  const worker = await startWorkerProcess({
    dataRoot: e2eDataRoot,
    environment: {
      MIRAWIND_AUTH_SECRET: "test-only-secret-0123456789-abcdef",
    },
    publicOrigin: e2eOrigin,
  });
  return async () => worker.stop();
}
