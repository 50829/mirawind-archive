import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { buildImmutableVersion } from "@/compiler/version-builder";
import { BookPresentationRepository } from "@/db/repositories/book-presentations";
import { JobRepository } from "@/db/repositories/jobs";
import { VersionRepository } from "@/db/repositories/versions";
import {
  verifyAndRecoverCurrentVersions,
  verifyVersionFully,
  verifyVersionQuickly,
} from "@/services/version-verifier";
import { finalizeImmutableVersion } from "@/storage/finalize-version";
import { reconcileStorage } from "@/storage/reconcile";

import { createTemporaryDataRoot } from "../../helpers/data-root.js";
import { openMigratedTestDatabase } from "../../helpers/database.js";
import {
  publicationTestLeaseOwner,
  publicationTestVersionId,
  setupPublicationFixture,
} from "../publication/stale-build.test.js";
import { publishReadyVersion } from "@/services/publication";
import { deriveBookVersionPresentation } from "@/services/book-presentation";

const sourceId = "src_stale_publish_test_0001";
const replacementVersionId = "ver_reconciliation_current_0001";

async function materializeVersion(
  root: Awaited<ReturnType<typeof createTemporaryDataRoot>>,
  bookId: number,
) {
  const draftRoot = resolve(root.layout.bookDirectory, String(bookId), "draft");
  const sourceRoot = resolve(draftRoot, "sources", "source");
  await mkdir(sourceRoot, { mode: 0o700, recursive: true });
  const markdown = "# Recovery chapter\n\nStable published body.";
  await writeFile(resolve(sourceRoot, "book.md"), markdown, { mode: 0o400 });
  const config = {
    book_id: bookId,
    metadata: { language: "en" },
    publishing: {
      code: { line_numbers: false },
      numbering: { mode: "normalized" },
    },
    revision: 1,
    schema_version: 1,
    source: {
      main_markdown: "book.md",
      main_markdown_sha256: createHash("sha256").update(markdown).digest("hex"),
      original_files: [],
    },
    structure: [
      {
        block_id: "blk_reconciliation_heading_0001",
        display_level: 1,
        include_in_toc: true,
        role: "body",
        starts_page: true,
      },
    ],
    title: "Recovery fixture",
  };
  const configPath = resolve(draftRoot, "configs", "1", "book.yaml");
  await mkdir(resolve(configPath, ".."), { mode: 0o700, recursive: true });
  await writeFile(configPath, stringify(config, { lineWidth: 0 }), {
    mode: 0o400,
  });
  const stagingDirectory = resolve(root.layout.root, "staging", "materialize");
  const artifact = await buildImmutableVersion({
    bookId,
    configRevision: 1,
    configYamlPath: configPath,
    createdAtMs: 10,
    draftRoot,
    predecessorVersionId: null,
    sourceId,
    sourceRoot,
    stagingDirectory,
    versionId: publicationTestVersionId,
  });
  const marker = JSON.parse(
    await readFile(
      resolve(stagingDirectory, "version", "version.json"),
      "utf8",
    ),
  ) as {
    compiler: { renderer_version: string; version: string };
    manifest_sha256: string;
  };
  await finalizeImmutableVersion({
    artifact,
    layout: root.layout,
    stagingDirectory,
  });
  return {
    marker,
    presentation: deriveBookVersionPresentation({
      bookConfig: await readFile(
        resolve(
          root.layout.bookDirectory,
          String(bookId),
          "versions",
          publicationTestVersionId,
          "book.yaml",
        ),
        "utf8",
      ),
      createdAtMs: 10,
      documentManifest: JSON.parse(
        await readFile(
          resolve(
            root.layout.bookDirectory,
            String(bookId),
            "versions",
            publicationTestVersionId,
            "document-manifest.json",
          ),
          "utf8",
        ),
      ) as unknown,
    }),
  };
}

describe("startup storage and current-version reconciliation", () => {
  it("cleans stale staging, quarantines orphans, preserves ready and rolls back only to a verified predecessor", async () => {
    const root = await createTemporaryDataRoot("reconciliation");
    const migrated = await openMigratedTestDatabase(root);
    try {
      const fixture = setupPublicationFixture(migrated.database);
      const materialized = await materializeVersion(root, fixture.book.id);
      const { marker } = materialized;
      const presentations = new BookPresentationRepository(migrated.database);
      presentations.delete(publicationTestVersionId);
      presentations.insert(materialized.presentation);
      migrated.database
        .prepare(
          `UPDATE book_versions
           SET manifest_sha256 = ?, compiler_version = ?, renderer_version = ?
           WHERE id = ?`,
        )
        .run(
          marker.manifest_sha256,
          marker.compiler.version,
          marker.compiler.renderer_version,
          publicationTestVersionId,
        );
      await publishReadyVersion({
        actorUserId: null,
        database: migrated.database,
        jobId: fixture.publishJob.id,
        leaseOwner: publicationTestLeaseOwner,
        nowMs: 20,
        versionId: publicationTestVersionId,
      });
      const versions = new VersionRepository(migrated.database);
      expect(
        await verifyVersionQuickly(
          root.layout,
          versions.require(publicationTestVersionId),
        ),
      ).toEqual({ ok: true });
      expect(
        await verifyVersionFully(
          root.layout,
          versions.require(publicationTestVersionId),
        ),
      ).toEqual({ ok: true });
      const pagePath = resolve(
        root.layout.bookDirectory,
        String(fixture.book.id),
        "versions",
        publicationTestVersionId,
        "published",
        "pages",
        "1.html",
      );
      const originalPage = await readFile(pagePath);
      const alteredPage = Buffer.from(originalPage);
      alteredPage[0] = alteredPage[0] === 60 ? 61 : 60;
      await chmod(pagePath, 0o600);
      await writeFile(pagePath, alteredPage);
      expect(
        await verifyVersionQuickly(
          root.layout,
          versions.require(publicationTestVersionId),
        ),
      ).toEqual({ ok: true });
      expect(
        await verifyVersionFully(
          root.layout,
          versions.require(publicationTestVersionId),
        ),
      ).toEqual({
        code: "VERSION_FILE_INTEGRITY_MISMATCH",
        ok: false,
      });
      await writeFile(pagePath, originalPage);
      await chmod(pagePath, 0o400);

      const jobs = new JobRepository(migrated.database);
      const replacementJob = jobs.create({
        bookId: fixture.book.id,
        capturedConfigRevision: 1,
        capturedCurrentVersionId: publicationTestVersionId,
        capturedSourceId: sourceId,
        kind: "build_publish",
        nowMs: 21,
      });
      jobs.fail(replacementJob.id, {
        errorClass: "content",
        errorCode: "TEST_BUILD_FAILED",
        nowMs: 22,
      });
      migrated.database.transaction(() => {
        migrated.database
          .prepare(
            `UPDATE book_versions SET state = 'superseded'
             WHERE id = ?`,
          )
          .run(publicationTestVersionId);
        migrated.database
          .prepare(
            `INSERT INTO book_versions (
               id, book_id, source_id, config_revision,
               predecessor_version_id, state, version_rel_path,
               manifest_schema_version, manifest_sha256, compiler_version,
               renderer_version, complete_at, published_at, verified_at,
               created_by_job_id
             ) VALUES (?, ?, ?, 1, ?, 'published', ?, 1, ?, ?, ?, 23, 23, 23, ?)`,
          )
          .run(
            replacementVersionId,
            fixture.book.id,
            sourceId,
            publicationTestVersionId,
            `books/${fixture.book.id}/versions/${replacementVersionId}`,
            "b".repeat(64),
            marker.compiler.version,
            marker.compiler.renderer_version,
            replacementJob.id,
          );
        migrated.database
          .prepare(
            `UPDATE books SET current_version_id = ?, updated_at = 23
             WHERE id = ?`,
          )
          .run(replacementVersionId, fixture.book.id);
      })();

      const staleStaging = "job_0123456789abcdefstale";
      await mkdir(resolve(root.layout.root, "staging", staleStaging), {
        recursive: true,
      });
      const activeJob = jobs.create({ kind: "reconcile", nowMs: 24 });
      jobs.claimNext({ leaseOwner: "worker-reconcile", nowMs: 25 });
      await mkdir(resolve(root.layout.root, "staging", activeJob.id), {
        recursive: true,
      });
      const orphanId = "ver_reconciliation_orphan_0001";
      await cp(
        resolve(
          root.layout.bookDirectory,
          String(fixture.book.id),
          "versions",
          publicationTestVersionId,
        ),
        resolve(
          root.layout.bookDirectory,
          String(fixture.book.id),
          "versions",
          orphanId,
        ),
        { recursive: true },
      );
      const readyId = "ver_reconciliation_ready_000001";
      const readyJob = jobs.create({
        bookId: fixture.book.id,
        kind: "build_publish",
        nowMs: 26,
      });
      jobs.fail(readyJob.id, {
        errorClass: "content",
        errorCode: "TEST_READY_ONLY",
        nowMs: 27,
      });
      const readyPath = `books/${fixture.book.id}/versions/${readyId}`;
      await mkdir(resolve(root.layout.root, readyPath), { recursive: true });
      migrated.database
        .prepare(
          `INSERT INTO book_versions (
             id, book_id, source_id, config_revision, predecessor_version_id,
             state, version_rel_path, manifest_schema_version, manifest_sha256,
             compiler_version, renderer_version, complete_at, published_at,
             verified_at, created_by_job_id
           ) VALUES (?, ?, ?, 1, ?, 'ready', ?, 1, ?, ?, ?, 27, NULL, NULL, ?)`,
        )
        .run(
          readyId,
          fixture.book.id,
          sourceId,
          replacementVersionId,
          readyPath,
          "c".repeat(64),
          marker.compiler.version,
          marker.compiler.renderer_version,
          readyJob.id,
        );
      expect(
        (
          await stat(
            resolve(root.layout.bookDirectory, String(fixture.book.id)),
          )
        ).mode & 0o777,
      ).toBe(0o700);
      expect(
        (
          await stat(
            resolve(
              root.layout.bookDirectory,
              String(fixture.book.id),
              "versions",
            ),
          )
        ).mode & 0o777,
      ).toBe(0o700);

      const result = await reconcileStorage({
        database: migrated.database,
        layout: root.layout,
        nowMs: 30,
      });
      expect(result.removedStagingDirectories).toContain(staleStaging);
      expect(result.removedStagingDirectories).not.toContain(activeJob.id);
      expect(result.quarantinedDirectories).toEqual([
        `books/${fixture.book.id}/quarantine/${orphanId}.30`,
      ]);
      expect(result.corruptDatabaseVersions).toContain(replacementVersionId);
      expect(result.recoveredCurrentVersions).toEqual([
        {
          bookId: fixture.book.id,
          failedVersionId: replacementVersionId,
          replacementVersionId: publicationTestVersionId,
        },
      ]);
      expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
        currentVersionId: publicationTestVersionId,
        unavailableReason: null,
      });
      expect(versions.require(readyId).state).toBe("ready");

      const authority = resolve(
        root.layout.root,
        versions.require(publicationTestVersionId).versionRelativePath,
        "book.yaml",
      );
      await chmod(authority, 0o600);
      await writeFile(authority, "tampered");
      const unavailable = await verifyAndRecoverCurrentVersions({
        database: migrated.database,
        layout: root.layout,
        nowMs: 31,
      });
      expect(unavailable).toEqual([
        {
          bookId: fixture.book.id,
          failedVersionId: publicationTestVersionId,
          replacementVersionId: null,
        },
      ]);
      expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
        currentVersionId: publicationTestVersionId,
        unavailableReason: "CURRENT_VERSION_CORRUPT",
      });
      await expect(
        stat(resolve(root.layout.root, "staging", staleStaging)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      migrated.close();
      await root.cleanup();
    }
  });
});
