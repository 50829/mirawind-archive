import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";

import type {
  BookVersionPresentation,
  BookVersionPresentationReconciliationStore,
} from "@/modules/catalog/application/public";
import { VersionRepository } from "@/modules/publishing/adapters/sqlite/versions";
import { deriveBookVersionPresentation } from "@/modules/publishing/application/derive-book-version-presentation";
import type { BookVersionRecord } from "@/modules/publishing/application/version-record";
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
  readonly presentations: BookVersionPresentationReconciliationStore;
}): Promise<PresentationReconciliation> {
  const versions = new VersionRepository(input.database);
  const rebuiltVersionIds: string[] = [];
  const mismatchedVersionIds: string[] = [];
  const failedVersionIds: string[] = [];
  for (const version of versions.listPresentationReconciliationCandidates()) {
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
      const existing = input.presentations.find(version.id);
      if (existing) {
        if (existing.projectionSha256 !== expected.projectionSha256) {
          mismatchedVersionIds.push(version.id);
        }
        continue;
      }
      input.presentations.insert(expected);
      rebuiltVersionIds.push(version.id);
    } catch {
      failedVersionIds.push(version.id);
    }
  }
  const repairedCurrentBookIds = input.presentations.repairCurrentAliases({
    excludedVersionIds: Object.freeze([
      ...failedVersionIds,
      ...mismatchedVersionIds,
    ]),
    nowMs: input.nowMs,
  });
  return Object.freeze({
    failedVersionIds: Object.freeze(failedVersionIds.sort()),
    mismatchedVersionIds: Object.freeze(mismatchedVersionIds.sort()),
    repairedCurrentBookIds,
    rebuiltVersionIds: Object.freeze(rebuiltVersionIds.sort()),
  });
}
