import { mkdir, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DraftRepository } from "@/db/repositories/drafts";
import { BookDeletionRepository } from "@/db/repositories/book-deletions";
import { JobRepository } from "@/db/repositories/jobs";
import { acceptBookDeletion } from "@/services/book-deletion";
import { createBookDeletionToken } from "@/services/book-deletion-token";
import { permanentlyCleanupBook } from "@/services/permanent-book-cleanup";
import { LibraryService } from "@/services/library";
import { PublishedBookService } from "@/services/published-book";
import {
  removeExactContainedTree,
  UnsafePermanentRemovalTargetError,
} from "@/storage/permanent-removal";

import { withMigratedTestDatabase } from "../../helpers/database";

describe("permanent book cleanup", () => {
  it("removes files before relational content and retains one content-free tombstone", async () => {
    await withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const drafts = new DraftRepository(database);
      const book = drafts.createBook({ nowMs: 1_000, title: "Cleanup me" });
      const importId = "imp_abcdefghijklmnop";
      database
        .prepare(
          `INSERT INTO imports (
            id, state, upload_rel_path, upload_size_bytes, upload_sha256,
            selected_candidate_id, book_id, safe_error_code,
            created_at, updated_at, expires_at
          ) VALUES (?, 'draft_ready', ?, 3, ?, NULL, ?, NULL, 1000, 1000, 9000)`,
        )
        .run(
          importId,
          `tmp/uploads/${importId}/original.zip`,
          "a".repeat(64),
          book.id,
        );
      const accepted = acceptBookDeletion({
        actorUserId: "admin",
        bookId: book.id,
        confirmationTitle: book.title,
        database,
        idempotencyKey: "delete-cleanup-request-0001",
        mutationToken: createBookDeletionToken({
          alias: book.alias,
          bookId: book.id,
          currentVersionId: book.currentVersionId,
          draftConfigRevision: book.draftConfigRevision,
          draftSourceId: book.draftSourceId,
          readyPreviewRevision: book.readyPreviewRevision,
          title: book.title,
          updatedAtMs: book.updatedAtMs,
        }),
        nowMs: 2_000,
      });
      const bookDirectory = resolve(
        dataRoot.layout.bookDirectory,
        String(book.id),
      );
      const uploadDirectory = resolve(
        dataRoot.layout.uploadDirectory,
        importId,
      );
      await mkdir(bookDirectory, { recursive: true });
      await mkdir(uploadDirectory, { recursive: true });
      await writeFile(resolve(bookDirectory, "private.md"), "secret");
      await writeFile(resolve(uploadDirectory, "original.zip"), "zip");

      await expect(
        permanentlyCleanupBook({
          bookId: book.id,
          database,
          jobId: accepted.jobId,
          layout: dataRoot.layout,
          nowMs: 3_000,
        }),
      ).resolves.toMatchObject({ removedUploadDirectories: 1 });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM books").get(),
      ).toEqual({ count: 0 });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM imports").get(),
      ).toEqual({ count: 0 });
      expect(
        new BookDeletionRepository(database).findById(accepted.deletionId),
      ).toMatchObject({
        bookId: book.id,
        completedAtMs: 3_000,
        state: "completed",
      });
      expect(
        database
          .prepare("SELECT book_id FROM jobs WHERE id = ?")
          .get(accepted.jobId),
      ).toEqual({ book_id: null });
      expect(database.pragma("foreign_key_check")).toEqual([]);
    });
  });

  it("purges the complete source/config/preview/version/search relationship graph", async () => {
    await withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const drafts = new DraftRepository(database);
      const book = drafts.createBook({ nowMs: 1_000, title: "Full graph" });
      const importId = "imp_fullgraphfixture";
      const sourceId = "src_fullgraphfixture";
      const fileId = "file_fullgraphfixture";
      const versionId = "ver_fullgraphfixture";
      database
        .prepare(
          `INSERT INTO imports (
            id, state, upload_rel_path, upload_size_bytes, upload_sha256,
            selected_candidate_id, book_id, safe_error_code,
            created_at, updated_at, expires_at
          ) VALUES (?, 'draft_ready', ?, 3, ?, NULL, ?, NULL, 1000, 1000, 9000)`,
        )
        .run(
          importId,
          `tmp/uploads/${importId}/original.zip`,
          "a".repeat(64),
          book.id,
        );
      database
        .prepare(
          `INSERT INTO source_snapshots (
            id, book_id, main_markdown_path, main_markdown_sha256,
            source_root_rel_path, analysis_version,
            created_from_import_id, created_at
          ) VALUES (?, ?, 'main.md', ?, ?, 'fixture-v1', ?, 1100)`,
        )
        .run(
          sourceId,
          book.id,
          "b".repeat(64),
          `books/${book.id}/draft/sources/${sourceId}`,
          importId,
        );
      database
        .prepare(
          `INSERT INTO config_revisions (
            book_id, revision, source_id, schema_version,
            yaml_rel_path, yaml_sha256, created_at
          ) VALUES (?, 1, ?, 2, ?, ?, 1200)`,
        )
        .run(
          book.id,
          sourceId,
          `books/${book.id}/draft/configs/1/book.yaml`,
          "c".repeat(64),
        );
      const contentJob = new JobRepository(database).create({
        bookId: book.id,
        capturedConfigRevision: 1,
        capturedSourceId: sourceId,
        kind: "build_publish",
        nowMs: 1_300,
      });
      database
        .prepare(
          `INSERT INTO draft_previews (
            book_id, config_revision, source_id, state, preview_rel_path,
            diagnostics_rel_path, created_by_job_id, completed_at
          ) VALUES (?, 1, ?, 'ready', ?, ?, ?, 1400)`,
        )
        .run(
          book.id,
          sourceId,
          `books/${book.id}/draft/previews/1`,
          `books/${book.id}/draft/previews/1/diagnostics.json`,
          contentJob.id,
        );
      database
        .prepare(
          `INSERT INTO original_files (
            id, book_id, source_id, role, storage_rel_path, original_name,
            media_type, size_bytes, sha256, created_at
          ) VALUES (?, ?, ?, 'mineru_zip', ?, 'private.zip',
                    'application/zip', 3, ?, 1400)`,
        )
        .run(
          fileId,
          book.id,
          sourceId,
          `books/${book.id}/draft/originals/${fileId}`,
          "d".repeat(64),
        );
      database
        .prepare(
          `INSERT INTO book_versions (
            id, book_id, source_id, config_revision, predecessor_version_id,
            state, version_rel_path, manifest_schema_version, manifest_sha256,
            compiler_version, renderer_version, complete_at, published_at,
            verified_at, created_by_job_id, reclaimed_at
          ) VALUES (?, ?, ?, 1, NULL, 'published', ?, 1, ?,
                    'fixture', 'fixture', 1500, 1500, 1500, ?, NULL)`,
        )
        .run(
          versionId,
          book.id,
          sourceId,
          `books/${book.id}/versions/${versionId}`,
          "e".repeat(64),
          contentJob.id,
        );
      database
        .prepare(
          `INSERT INTO book_version_presentations (
            version_id, book_id, config_revision, projection_schema_version,
            alias, title, metadata_json, cover_resource_id, first_page_id,
            first_page_alias, toc_preview_json, toc_entry_count,
            projection_sha256, created_at
          ) VALUES (?, ?, 1, 1, 'full-graph', 'Full graph', '{}', NULL, 1,
                    NULL, '[]', 0, ?, 1500)`,
        )
        .run(versionId, book.id, "f".repeat(64));
      database
        .prepare(
          `INSERT INTO search_short_fields (
            book_id, version_id, page_id, block_id, kind,
            normalized_text, ordinal
          ) VALUES (?, ?, 1, NULL, 'title', 'full graph', 0)`,
        )
        .run(book.id, versionId);
      database
        .prepare(
          `INSERT INTO search_fts (
            title, authors, heading, body, book_id, version_id,
            page_id, block_id, kind, ordinal
          ) VALUES ('Full graph', '', '', 'private body', ?, ?, 1,
                    'blk_fullgraphfixture', 'paragraph', 0)`,
        )
        .run(book.id, versionId);
      database
        .prepare(`UPDATE jobs SET version_id = ? WHERE id = ?`)
        .run(versionId, contentJob.id);
      database
        .prepare(
          `UPDATE books
           SET alias = 'full-graph', visibility = 'public',
               draft_source_id = ?, draft_config_revision = 1,
               ready_preview_revision = 1, current_version_id = ?,
               updated_at = 1600
           WHERE id = ?`,
        )
        .run(sourceId, versionId, book.id);
      const current = drafts.requireBook(book.id);
      const accepted = acceptBookDeletion({
        actorUserId: "admin",
        bookId: book.id,
        confirmationTitle: current.title,
        database,
        idempotencyKey: "delete-full-graph-0001",
        mutationToken: createBookDeletionToken({
          alias: current.alias,
          bookId: current.id,
          currentVersionId: current.currentVersionId,
          draftConfigRevision: current.draftConfigRevision,
          draftSourceId: current.draftSourceId,
          readyPreviewRevision: current.readyPreviewRevision,
          title: current.title,
          updatedAtMs: current.updatedAtMs,
        }),
        nowMs: 2_000,
      });
      expect(new LibraryService(database).publicLibrary().entries).toEqual([]);
      expect(() =>
        new PublishedBookService(database, dataRoot.layout).resolveCurrent(
          String(book.id),
          { allowed: true },
        ),
      ).toThrow(expect.objectContaining({ code: "NOT_FOUND", status: 404 }));

      await permanentlyCleanupBook({
        bookId: book.id,
        database,
        jobId: accepted.jobId,
        layout: dataRoot.layout,
        nowMs: 3_000,
      });
      for (const table of [
        "books",
        "imports",
        "source_snapshots",
        "config_revisions",
        "draft_previews",
        "original_files",
        "book_versions",
        "book_version_presentations",
        "search_short_fields",
        "audit_events",
      ]) {
        expect(
          database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
          table,
        ).toEqual({ count: 0 });
      }
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM search_fts").get(),
      ).toEqual({ count: 0 });
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM jobs
             WHERE book_id IS NOT NULL OR import_id IS NOT NULL
                OR version_id IS NOT NULL OR captured_source_id IS NOT NULL
                OR captured_config_revision IS NOT NULL
                OR captured_current_version_id IS NOT NULL`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM book_deletions").get(),
      ).toEqual({ count: 1 });
      expect(database.pragma("foreign_key_check")).toEqual([]);
    });
  });

  it("refuses root, escaped and symlink targets without following them", async () => {
    await withMigratedTestDatabase(async (_database, dataRoot) => {
      await expect(
        removeExactContainedTree({
          root: dataRoot.layout.bookDirectory,
          target: dataRoot.layout.bookDirectory,
        }),
      ).rejects.toBeInstanceOf(UnsafePermanentRemovalTargetError);
      await expect(
        removeExactContainedTree({
          root: dataRoot.layout.bookDirectory,
          target: dataRoot.layout.root,
        }),
      ).rejects.toBeInstanceOf(UnsafePermanentRemovalTargetError);
      const target = resolve(dataRoot.layout.bookDirectory, "999");
      await symlink(dataRoot.layout.databaseDirectory, target);
      await expect(
        removeExactContainedTree({
          root: dataRoot.layout.bookDirectory,
          target,
        }),
      ).rejects.toMatchObject({ code: "CLEANUP_UNSAFE_TARGET" });
    });
  });

  it("keeps the irreversible barrier and a safe retryable state after unsafe storage", async () => {
    await withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const drafts = new DraftRepository(database);
      const book = drafts.createBook({ nowMs: 1_000, title: "Unsafe target" });
      const accepted = acceptBookDeletion({
        actorUserId: "admin",
        bookId: book.id,
        confirmationTitle: book.title,
        database,
        idempotencyKey: "delete-unsafe-target-0001",
        mutationToken: createBookDeletionToken({
          alias: null,
          bookId: book.id,
          currentVersionId: null,
          draftConfigRevision: null,
          draftSourceId: null,
          readyPreviewRevision: null,
          title: book.title,
          updatedAtMs: book.updatedAtMs,
        }),
        nowMs: 2_000,
      });
      await symlink(
        dataRoot.layout.databaseDirectory,
        resolve(dataRoot.layout.bookDirectory, String(book.id)),
      );

      await expect(
        permanentlyCleanupBook({
          bookId: book.id,
          database,
          jobId: accepted.jobId,
          layout: dataRoot.layout,
          nowMs: 3_000,
        }),
      ).rejects.toThrow("CLEANUP_UNSAFE_TARGET");
      expect(
        new BookDeletionRepository(database).findById(accepted.deletionId),
      ).toMatchObject({
        safeErrorCode: "CLEANUP_UNSAFE_TARGET",
        state: "failed",
      });
      expect(drafts.findBook(book.id)).toBeNull();
      expect(
        database
          .prepare("SELECT deletion_requested_at FROM books WHERE id = ?")
          .get(book.id),
      ).toEqual({ deletion_requested_at: 2_000 });
    });
  });

  it("moves a failed irreversible cleanup tombstone to one explicit retry", async () => {
    await withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const drafts = new DraftRepository(database);
      const book = drafts.createBook({ nowMs: 1_000, title: "Retry cleanup" });
      const accepted = acceptBookDeletion({
        actorUserId: "admin",
        bookId: book.id,
        confirmationTitle: book.title,
        database,
        idempotencyKey: "delete-cleanup-retry-0001",
        mutationToken: createBookDeletionToken({
          alias: book.alias,
          bookId: book.id,
          currentVersionId: null,
          draftConfigRevision: null,
          draftSourceId: null,
          readyPreviewRevision: null,
          title: book.title,
          updatedAtMs: book.updatedAtMs,
        }),
        nowMs: 2_000,
      });
      const jobs = new JobRepository(database);
      jobs.fail(accepted.jobId, {
        errorClass: "infrastructure",
        errorCode: "JOB_HANDLER_FAILED",
        nowMs: 2_500,
      });
      expect(
        new BookDeletionRepository(database).findById(accepted.deletionId),
      ).toMatchObject({
        safeErrorCode: "CLEANUP_INTERRUPTED",
        state: "failed",
      });
      const retry = jobs.retry(accepted.jobId, {
        automatic: false,
        nowMs: 3_000,
      });
      expect(
        new BookDeletionRepository(database).findById(accepted.deletionId),
      ).toMatchObject({
        cleanupJobId: retry.id,
        safeErrorCode: null,
        state: "pending",
      });
      await permanentlyCleanupBook({
        bookId: book.id,
        database,
        jobId: retry.id,
        layout: dataRoot.layout,
        nowMs: 4_000,
      });
      expect(
        new BookDeletionRepository(database).findById(accepted.deletionId),
      ).toMatchObject({ state: "completed" });
    });
  });
});
