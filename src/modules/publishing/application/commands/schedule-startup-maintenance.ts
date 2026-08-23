import type { CurrentBookVersion } from "@/modules/catalog/application/public";
import type { BookVersionRecord } from "@/modules/publishing/application/version-record";

interface StartupJob {
  readonly id: string;
}

export interface StartupMaintenanceJobPort {
  queueReclamation(input: {
    readonly idempotencyKey: string;
    readonly nowMs: number;
  }): StartupJob;
  queueVersionVerification(input: {
    readonly bookId: number;
    readonly configRevision: number;
    readonly idempotencyKey: string;
    readonly nowMs: number;
    readonly sourceId: string;
    readonly versionId: string;
  }): StartupJob;
}

export function scheduleStartupPublishingMaintenance(input: {
  readonly bootId: string;
  readonly currentVersions: readonly CurrentBookVersion[];
  readonly jobs: StartupMaintenanceJobPort;
  readonly nowMs: number;
  readonly requireVersion: (versionId: string) => BookVersionRecord;
}): readonly StartupJob[] {
  const queued: StartupJob[] = [];
  for (const current of input.currentVersions) {
    const version = input.requireVersion(current.currentVersionId);
    if (version.bookId !== current.bookId || version.state !== "published") {
      throw new Error("STARTUP_VERSION_IDENTITY_INVALID");
    }
    queued.push(
      input.jobs.queueVersionVerification({
        bookId: version.bookId,
        configRevision: version.configRevision,
        idempotencyKey: `${input.bootId}:verify:${version.id}`,
        nowMs: input.nowMs,
        sourceId: version.sourceId,
        versionId: version.id,
      }),
    );
  }
  queued.push(
    input.jobs.queueReclamation({
      idempotencyKey: `${input.bootId}:storage:reclaim`,
      nowMs: input.nowMs,
    }),
  );
  return Object.freeze(queued);
}
