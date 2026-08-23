import type Database from "better-sqlite3";

import { CurrentVersionCatalogRepository } from "@/modules/catalog/adapters/sqlite/current-version-recovery";
import { VersionRepository } from "@/modules/publishing/adapters/sqlite/versions";
import {
  verifyAndRecoverCurrentVersions,
  verifyVersionFully,
  type CurrentVersionRecovery,
  type VersionVerificationResult,
} from "@/composition/version-verification";
import type { StorageLayout } from "@/platform/filesystem/layout";

export interface VersionVerificationOutcome {
  readonly recovery: CurrentVersionRecovery | null;
  readonly result: VersionVerificationResult;
  readonly versionId: string;
}

export async function verifyVersion(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
  readonly versionId: string;
}): Promise<VersionVerificationOutcome> {
  const repository = new VersionRepository(input.database);
  const version = repository.require(input.versionId);
  const result = await verifyVersionFully(input.layout, version);
  if (result.ok) {
    repository.markVerified(version.id, input.nowMs);
    return Object.freeze({
      recovery: null,
      result,
      versionId: version.id,
    });
  }

  repository.markCorrupt(version.id);
  const current = new CurrentVersionCatalogRepository(
    input.database,
  ).isCurrentVersion({ bookId: version.bookId, versionId: version.id });
  const recovery = current
    ? ((
        await verifyAndRecoverCurrentVersions({
          database: input.database,
          layout: input.layout,
          nowMs: input.nowMs,
        })
      ).find((item) => item.bookId === version.bookId) ?? null)
    : null;
  return Object.freeze({ recovery, result, versionId: version.id });
}
