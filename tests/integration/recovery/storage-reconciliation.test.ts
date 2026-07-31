import { access, mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { reconcileStorage } from "@/composition/storage-reconciliation";
import { publishingOrphanGraceMs } from "@/modules/publishing/adapters/filesystem/storage-reconciliation";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";

import { withMigratedTestDatabase } from "../../helpers/database.js";

const hash = "a".repeat(64);

async function write(path: string, value = "fixture"): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  await writeFile(path, value, { mode: 0o600 });
}

async function age(path: string, timestampMs: number): Promise<void> {
  const timestamp = new Date(timestampMs);
  await utimes(path, timestamp, timestamp);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("publishing storage reconciliation", () => {
  it("removes aged unregistered upload and draft artifacts while preserving registered and fresh writes", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const nowMs = Date.now();
      const oldMs = nowMs - publishingOrphanGraceMs - 1_000;
      const drafts = new DraftRepository(database);
      const imports = new ImportRepository(database);
      const sources = new SourceRepository(database);
      const book = drafts.createBook({ nowMs: 1, title: "Book" });
      const importId = "imp_reconcile_known_0001";
      const sourceId = "src_reconcile_known_0001";
      const originalId = "file_reconcile_known_0001";
      const knownUpload = `tmp/uploads/${importId}/original.zip`;
      const knownSource = `books/${book.id}/draft/sources/${sourceId}`;
      const knownOriginal = `books/${book.id}/draft/originals/${originalId}`;
      const knownConfig = `books/${book.id}/draft/configs/1/book.yaml`;
      const knownAnalysis = `books/${book.id}/draft/analyses/${sourceId}/1.json`;
      const canceledImportId = "imp_reconcile_canceled_0001";
      const canceledUpload = `tmp/uploads/${canceledImportId}/original.zip`;
      const canceledSealedExtraction = `tmp/uploads/${canceledImportId}/sealed-extraction`;

      imports.createUploaded({
        bookId: book.id,
        expiresAtMs: nowMs + 10_000,
        id: importId,
        nowMs: 2,
        originalName: "fixture.zip",
        uploadRelativePath: knownUpload,
        uploadSha256: hash,
        uploadSizeBytes: 1,
      });
      imports.createUploaded({
        expiresAtMs: nowMs + 10_000,
        id: canceledImportId,
        nowMs: 2,
        originalName: "fixture.zip",
        uploadRelativePath: canceledUpload,
        uploadSha256: hash,
        uploadSizeBytes: 1,
      });
      imports.startAnalysis(canceledImportId, 3);
      imports.cancel(canceledImportId, 4);
      sources.createSnapshot({
        analysisVersion: "test-v1",
        bookId: book.id,
        createdFromImportId: importId,
        id: sourceId,
        mainMarkdownPath: "book.md",
        mainMarkdownSha256: hash,
        nowMs: 3,
        sourceRootRelativePath: knownSource,
      });
      sources.registerOriginal({
        bookId: book.id,
        id: originalId,
        mediaType: "application/zip",
        nowMs: 3,
        originalName: "book.zip",
        sha256: hash,
        sizeBytes: 1,
        sourceId,
        storageRelativePath: knownOriginal,
      });
      drafts.addConfigRevision({
        bookId: book.id,
        nowMs: 4,
        revision: 1,
        schemaVersion: 3,
        sourceId,
        title: "Book",
        yamlRelativePath: knownConfig,
        yamlSha256: hash,
      });

      await Promise.all(
        [
          knownUpload,
          `${knownSource}/book.md`,
          knownOriginal,
          knownConfig,
          knownAnalysis,
          canceledUpload,
          `${canceledSealedExtraction}/tree/book.md`,
          `${canceledSealedExtraction}/marker.json`,
        ].map((path) => write(resolve(dataRoot.path, path))),
      );

      const orphanUpload = "tmp/uploads/imp_reconcile_orphan_0001";
      const freshUpload = "tmp/uploads/imp_reconcile_fresh_0001";
      const snapshot = `books/${book.id}/draft/.snapshot-src_reconcile_orphan_0001.part`;
      const orphanSource = `books/${book.id}/draft/sources/src_reconcile_orphan_0001`;
      const orphanOriginal = `books/${book.id}/draft/originals/file_reconcile_orphan_0001`;
      const orphanConfig = `books/${book.id}/draft/configs/2`;
      const freshConfig = `books/${book.id}/draft/configs/3`;
      const orphanAnalysis = `books/${book.id}/draft/analyses/${sourceId}/2.json`;

      await Promise.all([
        write(resolve(dataRoot.path, orphanUpload, "original.zip.part")),
        write(resolve(dataRoot.path, freshUpload, "original.zip.part")),
        mkdir(resolve(dataRoot.path, snapshot), {
          mode: 0o700,
          recursive: true,
        }),
        write(resolve(dataRoot.path, orphanSource, "book.md")),
        write(resolve(dataRoot.path, orphanOriginal)),
        write(resolve(dataRoot.path, orphanConfig, "book.yaml")),
        write(resolve(dataRoot.path, freshConfig, "book.yaml")),
        write(resolve(dataRoot.path, orphanAnalysis)),
      ]);
      for (const path of [
        `${orphanUpload}/original.zip.part`,
        orphanUpload,
        snapshot,
        `${orphanSource}/book.md`,
        orphanSource,
        orphanOriginal,
        `${orphanConfig}/book.yaml`,
        orphanConfig,
        orphanAnalysis,
      ]) {
        await age(resolve(dataRoot.path, path), oldMs);
      }

      const result = await reconcileStorage({
        database,
        layout: dataRoot.layout,
        nowMs,
      });

      expect(result.removedOrphanPaths).toEqual(
        [
          orphanConfig,
          orphanOriginal,
          orphanSource,
          snapshot,
          orphanAnalysis,
          orphanUpload,
          canceledSealedExtraction,
        ].sort(),
      );
      for (const path of result.removedOrphanPaths) {
        expect(await exists(resolve(dataRoot.path, path))).toBe(false);
      }
      for (const path of [
        knownUpload,
        knownSource,
        knownOriginal,
        knownConfig,
        knownAnalysis,
        canceledUpload,
        freshUpload,
        freshConfig,
      ]) {
        expect(await exists(resolve(dataRoot.path, path))).toBe(true);
      }
    }));
});
