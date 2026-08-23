import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { openDatabase } from "../../src/platform/sqlite/connection.js";
import { applyMigrations } from "../../src/platform/sqlite/migrate.js";
import { loadMigrationManifest } from "../../src/platform/sqlite/migration-manifest.js";
import { createStorageLayout } from "../../src/platform/filesystem/storage-layout.js";
import { reconcileStorage } from "../../src/composition/storage-reconciliation.js";

interface AuditArguments {
  readonly output: string;
  readonly sourceDataRoot: string;
}

interface TreeIdentity {
  readonly bytes: number;
  readonly files: number;
  readonly sha256: string;
}

function parseArguments(arguments_: readonly string[]): AuditArguments {
  if (
    arguments_.length !== 4 ||
    arguments_[0] !== "--source-data-root" ||
    arguments_[2] !== "--output" ||
    !arguments_[1] ||
    !arguments_[3]
  ) {
    throw new Error(
      "Usage: migration-recovery --source-data-root <path> --output <path>",
    );
  }
  return Object.freeze({
    output: resolve(arguments_[3]),
    sourceDataRoot: resolve(arguments_[1]),
  });
}

async function digestFile(path: string): Promise<{
  readonly bytes: number;
  readonly sha256: string;
}> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const value = chunk as Buffer;
    bytes += value.byteLength;
    hash.update(value);
  }
  return Object.freeze({ bytes, sha256: hash.digest("hex") });
}

async function treeIdentity(root: string): Promise<TreeIdentity> {
  const paths: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      Buffer.from(left.name).compare(Buffer.from(right.name)),
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("AUDIT_TREE_LINK_REJECTED");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(path);
      else throw new Error("AUDIT_TREE_SPECIAL_FILE_REJECTED");
    }
  };
  await visit(root);
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of paths) {
    const file = await digestFile(path);
    const relativePath = relative(root, path).split(sep).join("/");
    hash
      .update(relativePath, "utf8")
      .update("\0")
      .update(file.sha256, "ascii")
      .update("\0");
    bytes += file.bytes;
  }
  return Object.freeze({
    bytes,
    files: paths.length,
    sha256: hash.digest("hex"),
  });
}

async function removeAuditTree(path: string): Promise<void> {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata) return;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("AUDIT_TEMP_ROOT_INVALID");
  }
  const unlock = async (directory: string): Promise<void> => {
    await chmod(directory, 0o700);
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => unlock(join(directory, entry.name))),
    );
  };
  await unlock(path);
  await rm(path, { force: true, recursive: true });
}

function integrity(database: Database.Database): {
  readonly foreign_key_violations: number;
  readonly integrity_check: string;
} {
  const integrityRows = database.pragma("integrity_check") as {
    integrity_check: string;
  }[];
  const foreignKeyRows = database.pragma("foreign_key_check") as unknown[];
  return Object.freeze({
    foreign_key_violations: foreignKeyRows.length,
    integrity_check:
      integrityRows.length === 1 && integrityRows[0]?.integrity_check === "ok"
        ? "ok"
        : "failed",
  });
}

function representativeSnapshot(
  database: Database.Database,
): Readonly<Record<string, unknown>> {
  const count = (table: string): number =>
    Number(
      (
        database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as {
          count: number;
        }
      ).count,
    );
  const pointers = database
    .prepare(
      `SELECT id, current_version_id, access
       FROM books
       ORDER BY id`,
    )
    .all() as {
    current_version_id: string | null;
    id: number;
    access: string;
  }[];
  const pointerDigest = createHash("sha256")
    .update(JSON.stringify(pointers), "utf8")
    .digest("hex");
  return Object.freeze({
    audit_events: count("audit_events"),
    books: count("books"),
    current_pointer_sha256: pointerDigest,
    imports: count("imports"),
    jobs: count("jobs"),
    original_files: count("original_files"),
    public_books: pointers.filter((book) => book.access === "public").length,
    search_fts_rows: count("search_fts"),
    search_short_rows: count("search_short_fields"),
    source_snapshots: count("source_snapshots"),
    versions: count("book_versions"),
  });
}

async function exerciseMigrations(
  directory: string,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const migrations = await loadMigrationManifest();
  const databasePath = join(directory, "stepwise.sqlite");
  await mkdir(dirname(databasePath), { mode: 0o700, recursive: true });
  const database = openDatabase(databasePath, { role: "worker" });
  try {
    const results: Readonly<Record<string, unknown>>[] = [];
    for (let index = 0; index < migrations.length; index += 1) {
      const selected = migrations.slice(0, index + 1);
      const migration = selected.at(-1);
      if (!migration) throw new Error("AUDIT_MIGRATION_MISSING");
      const applied = applyMigrations(database, selected);
      const checked = integrity(database);
      if (
        applied.current !== migration.version ||
        checked.integrity_check !== "ok" ||
        checked.foreign_key_violations !== 0
      ) {
        throw new Error("AUDIT_STEPWISE_MIGRATION_FAILED");
      }
      results.push(
        Object.freeze({
          applied: applied.applied,
          checksum: migration.checksum,
          integrity: checked,
          name: migration.name,
          version: migration.version,
        }),
      );
    }
    return Object.freeze(results);
  } finally {
    database.close();
  }
}

function reportMarkdown(report: Readonly<Record<string, unknown>>): string {
  const migrations = report.migrations as readonly Readonly<
    Record<string, unknown>
  >[];
  const representative = report.representative as Readonly<
    Record<string, unknown>
  >;
  const snapshot = representative.logical_snapshot as Readonly<
    Record<string, unknown>
  >;
  const backup = report.backup_restore as Readonly<Record<string, unknown>>;
  const recovery = report.version_recovery as Readonly<Record<string, unknown>>;
  return `# M1 migration and recovery report

- Captured: ${String(report.captured_at)}
- Result: **${String(report.status).toUpperCase()}**
- Representative data: one Git-ignored MinerU 3.4.4 production-build data root, copied to a disposable directory before mutation
- Representative logical shape: ${String(snapshot.books)} book, ${String(snapshot.versions)} immutable versions, ${String(snapshot.jobs)} jobs, ${String(snapshot.search_fts_rows)} FTS rows, ${String(snapshot.original_files)} registered original

## Stepwise migrations

Version | Name | Checksum | Applied | Integrity | Foreign-key violations
---: | --- | --- | --- | --- | ---:
${migrations
  .map(
    (migration) =>
      `${String(migration.version)} | ${String(migration.name)} | ${String(migration.checksum)} | ${(migration.applied as readonly number[]).join(", ")} | ${String((migration.integrity as Record<string, unknown>).integrity_check)} | ${String((migration.integrity as Record<string, unknown>).foreign_key_violations)}`,
  )
  .join("\n")}

## Backup and restore

- SQLite online backup SHA-256: \`${String(backup.database_backup_sha256)}\`
- Pre-backup and restored logical snapshots match: ${String(backup.logical_snapshot_matches)}
- Restored database integrity: ${String((backup.restored_integrity as Record<string, unknown>).integrity_check)}
- Restored foreign-key violations: ${String((backup.restored_integrity as Record<string, unknown>).foreign_key_violations)}
- Full persistent-tree copy identity matches before testing: ${String(backup.persistent_copy_identity_matches)}
- Copied tree: ${String((representative.tree_identity as Record<string, unknown>).files)} files, ${String((representative.tree_identity as Record<string, unknown>).bytes)} bytes, aggregate SHA-256 \`${String((representative.tree_identity as Record<string, unknown>).sha256)}\`

## Version recovery

- Deliberately corrupted current version detected: ${String(recovery.detected)}
- Previously verified superseded version promoted: ${String(recovery.replacement_promoted)}
- Public book retained a non-null current pointer: ${String(recovery.public_pointer_available)}
- Recovery audit event recorded: ${String(recovery.audit_event_recorded)}

The corruption and restore operations ran only inside a disposable copy. The source fixture, its ZIP, its private text and all original filenames were neither modified nor written to this report. Temporary test copies were removed after evidence capture.
`;
}

export async function runMigrationRecoveryAudit(input: AuditArguments) {
  const source = await lstat(input.sourceDataRoot);
  if (
    !source.isDirectory() ||
    source.isSymbolicLink() ||
    input.sourceDataRoot === "/"
  ) {
    throw new Error("AUDIT_SOURCE_DATA_ROOT_INVALID");
  }
  const temporaryBase = await mkdtemp(
    join(tmpdir(), "mirawind-migration-recovery-audit-"),
  );
  const disposableRoot = join(temporaryBase, "representative-data");
  const migrationRoot = join(temporaryBase, "migrations");
  try {
    const sourceIdentity = await treeIdentity(input.sourceDataRoot);
    await cp(input.sourceDataRoot, disposableRoot, {
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: true,
    });
    const copyIdentity = await treeIdentity(disposableRoot);
    if (JSON.stringify(copyIdentity) !== JSON.stringify(sourceIdentity)) {
      throw new Error("AUDIT_PERSISTENT_COPY_MISMATCH");
    }

    const migrations = await exerciseMigrations(migrationRoot);
    const layout = await createStorageLayout(disposableRoot);
    const databasePath = join(layout.databaseDirectory, "mirawind.sqlite");
    const database = openDatabase(databasePath, { role: "worker" });
    const backupPath = join(temporaryBase, "backups", "mirawind.sqlite");
    await mkdir(dirname(backupPath), { mode: 0o700, recursive: true });
    let before: Readonly<Record<string, unknown>>;
    try {
      const migrationResult = applyMigrations(
        database,
        await loadMigrationManifest(),
      );
      if (migrationResult.applied.length !== 0) {
        throw new Error("AUDIT_REPRESENTATIVE_SCHEMA_STALE");
      }
      const checked = integrity(database);
      if (
        checked.integrity_check !== "ok" ||
        checked.foreign_key_violations !== 0
      ) {
        throw new Error("AUDIT_REPRESENTATIVE_INTEGRITY_FAILED");
      }
      before = representativeSnapshot(database);
      if (
        Number(before.books) < 1 ||
        Number(before.versions) < 2 ||
        Number(before.search_fts_rows) < 1
      ) {
        throw new Error("AUDIT_REPRESENTATIVE_DATA_INSUFFICIENT");
      }
      await database.backup(backupPath);
    } finally {
      database.close();
    }

    const backupDigest = await digestFile(backupPath);
    const displacedPath = `${databasePath}.simulated-loss`;
    await rename(databasePath, displacedPath);
    await copyFile(backupPath, databasePath);
    await rm(`${databasePath}-wal`, { force: true });
    await rm(`${databasePath}-shm`, { force: true });

    const restored = openDatabase(databasePath, { role: "worker" });
    let restoredIntegrity;
    let after;
    try {
      restoredIntegrity = integrity(restored);
      after = representativeSnapshot(restored);
    } finally {
      restored.close();
    }
    const logicalSnapshotMatches =
      JSON.stringify(before) === JSON.stringify(after);
    if (
      !logicalSnapshotMatches ||
      restoredIntegrity.integrity_check !== "ok" ||
      restoredIntegrity.foreign_key_violations !== 0
    ) {
      throw new Error("AUDIT_DATABASE_RESTORE_FAILED");
    }

    const recoveryDatabase = openDatabase(databasePath, { role: "worker" });
    let recovery;
    try {
      const current = recoveryDatabase
        .prepare(
          `SELECT books.id AS book_id, books.current_version_id,
                  book_versions.version_rel_path
           FROM books
           JOIN book_versions ON book_versions.id = books.current_version_id
           WHERE books.access = 'public'
           ORDER BY books.id
           LIMIT 1`,
        )
        .get() as
        | {
            book_id: number;
            current_version_id: string;
            version_rel_path: string;
          }
        | undefined;
      if (!current) throw new Error("AUDIT_CURRENT_VERSION_MISSING");
      const markerPath = join(
        layout.root,
        current.version_rel_path,
        "version.json",
      );
      await chmod(markerPath, 0o600);
      await writeFile(markerPath, "{corrupt", { mode: 0o600 });
      const result = await reconcileStorage({
        database: recoveryDatabase,
        layout,
        nowMs: Date.now(),
      });
      const bookAfter = recoveryDatabase
        .prepare("SELECT current_version_id, access FROM books WHERE id = ?")
        .get(current.book_id) as {
        current_version_id: string | null;
        access: string;
      };
      const event = recoveryDatabase
        .prepare(
          `SELECT COUNT(*) AS count
           FROM audit_events
           WHERE action = 'book.version.recovered'
             AND book_id = ?`,
        )
        .get(current.book_id) as { count: number };
      const item = result.recoveredCurrentVersions.find(
        (candidate) => candidate.bookId === current.book_id,
      );
      recovery = Object.freeze({
        audit_event_recorded: event.count > 0,
        detected: item?.failedVersionId === current.current_version_id,
        public_pointer_available:
          bookAfter.access === "public" &&
          typeof bookAfter.current_version_id === "string",
        replacement_promoted:
          typeof item?.replacementVersionId === "string" &&
          bookAfter.current_version_id === item.replacementVersionId,
      });
      if (Object.values(recovery).some((value) => value !== true)) {
        throw new Error("AUDIT_VERSION_RECOVERY_FAILED");
      }
    } finally {
      recoveryDatabase.close();
    }

    const report = Object.freeze({
      backup_restore: {
        database_backup_bytes: backupDigest.bytes,
        database_backup_sha256: backupDigest.sha256,
        logical_snapshot_matches: logicalSnapshotMatches,
        persistent_copy_identity_matches: true,
        restored_integrity: restoredIntegrity,
      },
      captured_at: new Date().toISOString(),
      migrations,
      representative: {
        logical_snapshot: before,
        source_scope: "git_ignored_mineru_3_4_4_reference_data",
        tree_identity: sourceIdentity,
      },
      schema_version: 1,
      status: "passed",
      version_recovery: recovery,
    });
    await mkdir(dirname(input.output), { mode: 0o700, recursive: true });
    await writeFile(input.output, reportMarkdown(report), { mode: 0o600 });
    return report;
  } finally {
    await removeAuditTree(temporaryBase);
  }
}

async function main(): Promise<void> {
  const input = parseArguments(process.argv.slice(2));
  const report = await runMigrationRecoveryAudit(input);
  process.stdout.write(
    `${JSON.stringify({ output: input.output, status: report.status })}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "MIGRATION_RECOVERY_AUDIT_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
