import type Database from "better-sqlite3";

import { VersionRepository } from "@/db/repositories/versions";
import {
  verifyAndRecoverCurrentVersions,
  verifyVersionFully,
  type CurrentVersionRecovery,
  type VersionVerificationResult,
} from "@/services/version-verifier";
import type { StorageLayout } from "@/storage/layout";

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
  const current = input.database
    .prepare(
      `SELECT 1 FROM books
       WHERE id = ? AND current_version_id = ?
         AND deletion_requested_at IS NULL`,
    )
    .get(version.bookId, version.id);
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
