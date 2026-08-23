import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

import { reconcileStorage } from "../storage-reconciliation";
import { recoverWorkerAttempts } from "./recover-attempts";
import { WorkerHealthReporter } from "./health-reporter";
import { runWorkerLoop } from "./loop";
import { parseEnvironment } from "@/config/environment";
import { CurrentVersionCatalogRepository } from "@/modules/catalog/adapters/sqlite/current-version-recovery";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { VersionRepository } from "@/modules/publishing/adapters/sqlite/versions";
import { scheduleStartupPublishingMaintenance } from "@/modules/publishing/application/publishing-api";
import { WorkerCheckpointScheduler } from "@/entrypoints/worker/checkpoint";
import { operationalMetrics } from "@/observability/metrics";
import { createStorageLayout } from "@/platform/filesystem/storage-layout";
import { atomicWriteFile } from "@/platform/filesystem/atomic-file";
import { openDatabase } from "@/platform/sqlite/connection";

function runtimeMode(): "development" | "production" | "test" {
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "test") return "test";
  return "development";
}

export async function runWorkerMain(): Promise<void> {
  const shutdownController = new AbortController();
  const requestShutdown = (signal: NodeJS.Signals) => {
    if (!shutdownController.signal.aborted) shutdownController.abort(signal);
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

  const environment = parseEnvironment(process.env, { mode: runtimeMode() });
  const layout = await createStorageLayout(environment.dataDirectory);
  const databasePath = join(environment.dataDirectory, "db", "mirawind.sqlite");
  const database = openDatabase(databasePath, { role: "worker" });
  const pidPath = join(layout.temporaryDirectory, "worker.pid");
  try {
    const bootId = randomUUID();
    const workerId = `worker:${hostname()}:${process.pid}:${bootId}`;
    const repository = new JobRepository(database);
    const candidates = new DraftCandidateRepository(database);
    await recoverWorkerAttempts({
      candidates,
      database,
      nowMs: Date.now(),
      repository,
      storageRoot: layout.root,
    });
    const reconciliation = await reconcileStorage({
      database,
      layout,
      nowMs: Date.now(),
    });
    if (
      reconciliation.corruptDatabaseVersions.length > 0 ||
      reconciliation.quarantinedDirectories.length > 0 ||
      reconciliation.recoveredCurrentVersions.length > 0 ||
      reconciliation.removedOrphanPaths.length > 0 ||
      reconciliation.removedStagingDirectories.length > 0
    ) {
      operationalMetrics.recordTransition("recovery.startup_changed");
    }
    const versions = new VersionRepository(database);
    const currentVersions = new CurrentVersionCatalogRepository(
      database,
    ).listCurrentVersions();
    scheduleStartupPublishingMaintenance({
      bootId,
      currentVersions,
      jobs: {
        queueReclamation: ({ idempotencyKey, nowMs }) =>
          repository.create({
            idempotency: {
              key: idempotencyKey,
              operation: "storage.reclaim",
            },
            kind: "reclaim_versions",
            nowMs,
          }),
        queueVersionVerification: (version) =>
          repository.create({
            bookId: version.bookId,
            capturedConfigRevision: version.configRevision,
            capturedSourceId: version.sourceId,
            idempotency: {
              key: version.idempotencyKey,
              operation: "version.verify",
            },
            kind: "verify_version",
            nowMs: version.nowMs,
            versionId: version.versionId,
          }),
      },
      nowMs: Date.now(),
      requireVersion: (versionId) => versions.require(versionId),
    });
    const scheduler = new WorkerCheckpointScheduler({
      database,
      databasePath,
      layout,
    });
    const healthReporter = new WorkerHealthReporter(layout);
    const initialNowMs = Date.now();
    const checkpoint = await scheduler.checkpointIfDue(initialNowMs);
    if (checkpoint) healthReporter.recordCheckpoint(checkpoint, initialNowMs);
    healthReporter.recordQueue(
      repository.observeQueue(initialNowMs),
      initialNowMs,
    );
    await healthReporter.drain();
    await operationalMetrics.collectDiskUsage(layout.root);
    await atomicWriteFile(pidPath, `${process.pid}\n`, { mode: 0o600 });
    process.stdout.write("Mirawind worker ready\n");
    await runWorkerLoop({
      candidates,
      database,
      drafts: new DraftRepository(database),
      imports: new ImportRepository(database),
      layout,
      onAttemptObservation: (observation) =>
        healthReporter.recordAttempt(observation),
      onCheckpoint: (health, nowMs) =>
        healthReporter.recordCheckpoint(health, nowMs),
      onQueueObservation: (observation) =>
        healthReporter.recordQueue(observation),
      repository,
      scheduler,
      shutdownSignal: shutdownController.signal,
      sources: new SourceRepository(database),
      workerId,
    });
    await healthReporter.drain();
  } finally {
    await rm(pidPath, { force: true });
    database.close();
  }
}
