import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { SourceSnapshotService } from "@/modules/publishing/adapters/filesystem/source-snapshot";

import { withMigratedTestDatabase } from "../../helpers/database.js";

const sha256 = "a".repeat(64);

async function writeFixture(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

describe("immutable accepted source snapshots", () => {
  it("retains only the main Markdown and referenced resources", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const extracted = resolve(dataRoot.path, "extracted");
      const original = resolve(dataRoot.path, "upload.zip");
      await writeFixture(
        resolve(extracted, "outer/book/book.md"),
        "# Book\n\n![image](images/a.png)",
      );
      await writeFixture(
        resolve(extracted, "outer/book/images/a.png"),
        "image",
      );
      await writeFixture(
        resolve(extracted, "outer/book/images/unused.png"),
        "unused image",
      );
      await writeFixture(
        resolve(extracted, "outer/book/book_layout.pdf"),
        "layout",
      );
      await writeFixture(
        resolve(extracted, "outer/book/book_span.pdf"),
        "span",
      );
      await writeFixture(
        resolve(extracted, "outer/book/book_middle.json"),
        "{}",
      );
      await writeFixture(
        resolve(extracted, "outer/book/book_model.json"),
        "{}",
      );
      await writeFixture(resolve(extracted, "outer/book/notes.txt"), "notes");
      await writeFixture(resolve(extracted, "outer/ignored.txt"), "ignored");
      await writeFile(original, "PK original");

      const drafts = new DraftRepository(database);
      const imports = new ImportRepository(database);
      const book = drafts.createBook({ nowMs: 1, title: "Book" });
      const imported = imports.createUploaded({
        bookId: book.id,
        expiresAtMs: 10_000,
        id: "imp_abcdefghijklmnop",
        nowMs: 2,
        originalName: "fixture.zip",
        uploadRelativePath: "tmp/upload.zip",
        uploadSha256: sha256,
        uploadSizeBytes: 11,
      });
      const service = new SourceSnapshotService(database, dataRoot.layout);
      const snapshot = await service.create({
        analysisVersion: "candidate-v1",
        bookId: book.id,
        extractedRoot: extracted,
        importId: imported.id,
        mainMarkdownRelativePath: "outer/book/book.md",
        nowMs: 3,
        originalArchivePath: original,
        originalName: "../unsafe\u0000name.zip",
        resourceRelativePaths: ["images/a.png"],
      });
      const sourceRoot = resolve(
        dataRoot.layout.root,
        snapshot.source.sourceRootRelativePath,
      );
      const originalPath = resolve(
        dataRoot.layout.root,
        snapshot.original.storageRelativePath,
      );

      expect(snapshot.source.sourceRootRelativePath).toBe(
        `books/${book.id}/draft/sources/${snapshot.source.id}`,
      );
      expect(snapshot.source.mainMarkdownPath).toBe("book.md");
      expect(await readFile(resolve(sourceRoot, "book.md"), "utf8")).toContain(
        "# Book",
      );
      expect(await readFile(resolve(sourceRoot, "images/a.png"), "utf8")).toBe(
        "image",
      );
      expect((await readdir(sourceRoot)).sort()).toEqual(["book.md", "images"]);
      expect(await readdir(resolve(sourceRoot, "images"))).toEqual(["a.png"]);
      expect(await readFile(originalPath, "utf8")).toBe("PK original");
      expect(snapshot.original.originalName).toBe("unsafe_name.zip");
      expect((await stat(resolve(sourceRoot, "book.md"))).mode & 0o222).toBe(0);
      expect((await stat(sourceRoot)).mode & 0o222).toBe(0);
    }));

  it("removes staged and finalized files when database indexing rolls back", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const extracted = resolve(dataRoot.path, "extracted");
      const original = resolve(dataRoot.path, "upload.zip");
      await writeFixture(resolve(extracted, "book.md"), "# Book");
      await writeFile(original, "PK original");
      const imports = new ImportRepository(database);
      const imported = imports.createUploaded({
        expiresAtMs: 10_000,
        id: "imp_abcdefghijklmnop",
        nowMs: 2,
        originalName: "fixture.zip",
        uploadRelativePath: "tmp/upload.zip",
        uploadSha256: sha256,
        uploadSizeBytes: 11,
      });
      const service = new SourceSnapshotService(database, dataRoot.layout);

      await expect(
        service.create({
          analysisVersion: "candidate-v1",
          bookId: 999,
          extractedRoot: extracted,
          importId: imported.id,
          mainMarkdownRelativePath: "book.md",
          nowMs: 3,
          originalArchivePath: original,
          originalName: "upload.zip",
          resourceRelativePaths: [],
        }),
      ).rejects.toThrow();
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM source_snapshots")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM original_files").get(),
      ).toEqual({ count: 0 });
      const failedDraftRoot = resolve(
        dataRoot.layout.bookDirectory,
        "999",
        "draft",
      );
      expect(
        await readdir(failedDraftRoot, { recursive: true }).catch(() => []),
      ).toEqual([]);
    }));
});
