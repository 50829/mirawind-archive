import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { openDatabase } from "@/db/connection";
import {
  passiveCheckpointIntervalMs,
  runMaintenanceCheckpoint,
  runPassiveCheckpoint,
  WorkerCheckpointScheduler,
} from "@/worker/checkpoint";

import { createTemporaryDataRoot } from "../../helpers/data-root.js";
import { openMigratedTestDatabase } from "../../helpers/database.js";

describe("worker-owned WAL operations", () => {
  it("keeps Web busy bounds while a worker performs PASSIVE checkpoints", async () => {
    const root = await createTemporaryDataRoot("wal-operations");
    const migrated = await openMigratedTestDatabase(root);
    const web = openDatabase(migrated.path, { role: "web" });
    try {
      expect(web.pragma("busy_timeout", { simple: true })).toBe(250);
      migrated.database.exec(
        "CREATE TABLE wal_test (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
      );
      web.exec("BEGIN");
      web.prepare("SELECT COUNT(*) FROM wal_test").get();
      const insert = migrated.database.prepare(
        "INSERT INTO wal_test(value) VALUES (?)",
      );
      migrated.database.transaction(() => {
        for (let index = 0; index < 1_000; index += 1) {
          insert.run(`row-${index}`);
        }
      })();

      const startedAt = performance.now();
      expect(
        web.prepare("SELECT COUNT(*) AS count FROM wal_test").get(),
      ).toEqual({ count: 0 });
      expect(performance.now() - startedAt).toBeLessThan(250);
      const health = await runPassiveCheckpoint({
        database: migrated.database,
        databasePath: migrated.path,
        layout: root.layout,
        nowMs: 1_000,
      });
      expect(health.checkpoint.mode).toBe("PASSIVE");
      expect(health.walBytes).toBeGreaterThan(0);
      expect(health.lease.activeJobs).toBe(0);
      web.exec("ROLLBACK");
      expect(
        web.prepare("SELECT COUNT(*) AS count FROM wal_test").get(),
      ).toEqual({ count: 1_000 });

      const scheduler = new WorkerCheckpointScheduler({
        database: migrated.database,
        databasePath: migrated.path,
        layout: root.layout,
      });
      await expect(scheduler.checkpointIfDue(2_000)).resolves.not.toBeNull();
      await expect(
        scheduler.checkpointIfDue(2_000 + passiveCheckpointIntervalMs - 1),
      ).resolves.toBeNull();
      await expect(
        scheduler.checkpointIfDue(2_000 + passiveCheckpointIntervalMs),
      ).resolves.not.toBeNull();
      expect(() =>
        runMaintenanceCheckpoint({
          database: migrated.database,
          maintenance: false as true,
          mode: "TRUNCATE",
        }),
      ).toThrow("WAL_MAINTENANCE_CONFIRMATION_REQUIRED");
    } finally {
      web.close();
      migrated.close();
      await root.cleanup();
    }
  });

  it("opens a Web connection against uncheckpointed WAL state on startup", async () => {
    const root = await createTemporaryDataRoot("wal-startup");
    const migrated = await openMigratedTestDatabase(root);
    let web;
    try {
      migrated.database.exec(
        "CREATE TABLE wal_startup_test (value TEXT NOT NULL)",
      );
      migrated.database
        .prepare("INSERT INTO wal_startup_test(value) VALUES ('durable')")
        .run();
      web = openDatabase(migrated.path, { role: "web" });
      expect(web.prepare("SELECT value FROM wal_startup_test").get()).toEqual({
        value: "durable",
      });
    } finally {
      web?.close();
      migrated.close();
      await root.cleanup();
    }
  });
});
