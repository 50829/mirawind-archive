import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";

import {
  deriveBookVersionPresentation,
  type BookVersionPresentation,
} from "@/modules/catalog/application/public";
import { BookPresentationRepository } from "@/modules/catalog/adapters/sqlite/book-presentations";
import type { BookVersionRecord } from "@/modules/publishing/application/public";
import type { StorageLayout } from "@/platform/filesystem/layout";
import { resolveContainedPath } from "@/platform/filesystem/layout";

const maximumConfigBytes = 4 * 1024 * 1024;
const maximumManifestBytes = 64 * 1024 * 1024;

async function defaultLoadPresentation(
  layout: StorageLayout,
  version: BookVersionRecord,
): Promise<BookVersionPresentation> {
  const directory = await resolveContainedPath(
    layout.root,
    version.versionRelativePath,
  );
  const [configBytes, manifestBytes] = await Promise.all([
    readFile(resolve(directory, "book.yaml")),
    readFile(resolve(directory, "document-manifest.json")),
  ]);
  if (configBytes.byteLength > maximumConfigBytes) {
    throw new Error("PRESENTATION_CONFIG_LIMIT");
  }
  if (manifestBytes.byteLength > maximumManifestBytes) {
    throw new Error("PRESENTATION_MANIFEST_LIMIT");
  }
  return deriveBookVersionPresentation({
    bookConfig: configBytes.toString("utf8"),
    createdAtMs: version.completeAtMs,
    documentManifest: JSON.parse(manifestBytes.toString("utf8")) as unknown,
  });
}

export interface PresentationReconciliation {
  readonly failedVersionIds: readonly string[];
  readonly mismatchedVersionIds: readonly string[];
  readonly repairedCurrentBookIds: readonly number[];
  readonly rebuiltVersionIds: readonly string[];
}

export async function reconcileBookVersionPresentations(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly loadPresentation?: (
    version: BookVersionRecord,
  ) => Promise<BookVersionPresentation>;
  readonly nowMs: number;
}): Promise<PresentationReconciliation> {
  const repository = new BookPresentationRepository(input.database);
  const rebuiltVersionIds: string[] = [];
  const mismatchedVersionIds: string[] = [];
  const failedVersionIds: string[] = [];
  for (const version of repository.listReconciliationCandidates()) {
    try {
      const expected = await (input.loadPresentation
        ? input.loadPresentation(version)
        : defaultLoadPresentation(input.layout, version));
      if (
        expected.versionId !== version.id ||
        expected.bookId !== version.bookId ||
        expected.configRevision !== version.configRevision
      ) {
        throw new Error("PRESENTATION_IDENTITY_MISMATCH");
      }
      const existing = repository.find(version.id);
      if (existing) {
        if (existing.projectionSha256 !== expected.projectionSha256) {
          mismatchedVersionIds.push(version.id);
        }
        continue;
      }
      repository.insert(expected);
      rebuiltVersionIds.push(version.id);
    } catch {
      failedVersionIds.push(version.id);
    }
  }
  const rejected = new Set([...failedVersionIds, ...mismatchedVersionIds]);
  const repairedCurrentBookIds: number[] = [];
  const currentRows = input.database
    .prepare(
      `SELECT books.id, books.alias, books.current_version_id,
              presentation.alias AS presentation_alias
       FROM books
       JOIN book_version_presentations AS presentation
         ON presentation.version_id = books.current_version_id
        AND presentation.book_id = books.id
       WHERE books.current_version_id IS NOT NULL
         AND books.deletion_requested_at IS NULL
       ORDER BY books.id`,
    )
    .all() as {
    alias: string | null;
    current_version_id: string;
    id: number;
    presentation_alias: string | null;
  }[];
  for (const row of currentRows) {
    if (
      rejected.has(row.current_version_id) ||
      row.alias === row.presentation_alias
    ) {
      continue;
    }
    const changed = input.database
      .prepare(
        `UPDATE books SET alias = ?, updated_at = ?
         WHERE id = ? AND current_version_id = ?
           AND deletion_requested_at IS NULL`,
      )
      .run(row.presentation_alias, input.nowMs, row.id, row.current_version_id);
    if (changed.changes === 1) repairedCurrentBookIds.push(row.id);
  }
  return Object.freeze({
    failedVersionIds: Object.freeze(failedVersionIds.sort()),
    mismatchedVersionIds: Object.freeze(mismatchedVersionIds.sort()),
    repairedCurrentBookIds: Object.freeze(repairedCurrentBookIds.sort()),
    rebuiltVersionIds: Object.freeze(rebuiltVersionIds.sort()),
  });
}
