import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { storeMultipartImport } from "@/http/multipart/import-form";
import { m1ImportExpiryMs } from "@/modules/publishing/application/public";

import { withMigratedTestDatabase } from "../../helpers/database.js";

describe("streaming multipart import form", () => {
  it("accepts exactly one ZIP stream and an order-independent target book field", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const book = new DraftRepository(database).createBook({
        nowMs: 1,
        title: "Existing book",
      });
      const form = new FormData();
      form.append(
        "file",
        new Blob(["PK streamed"], { type: "application/zip" }),
        "unsafe/../upload.zip",
      );
      form.append("target_book_id", String(book.id));
      const request = new Request("http://localhost/api/manage/imports", {
        body: form,
        method: "POST",
      });
      const result = await storeMultipartImport({
        database,
        idempotencyKey: "multipart-upload-0001",
        layout: dataRoot.layout,
        request,
      });

      expect(result.import).toMatchObject({
        bookId: book.id,
        expiresAtMs: m1ImportExpiryMs,
        state: "uploaded",
        uploadSizeBytes: 11,
      });
      expect(
        await readFile(
          resolve(dataRoot.layout.root, result.import.uploadRelativePath),
          "utf8",
        ),
      ).toBe("PK streamed");
    }));

  it("rejects unknown fields and leaves no upload or database record", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const form = new FormData();
      form.append("unknown", "value");
      form.append(
        "file",
        new Blob(["PK streamed"], { type: "application/zip" }),
        "upload.zip",
      );
      const request = new Request("http://localhost/api/manage/imports", {
        body: form,
        method: "POST",
      });

      await expect(
        storeMultipartImport({
          database,
          idempotencyKey: "multipart-invalid-001",
          layout: dataRoot.layout,
          request,
        }),
      ).rejects.toMatchObject({ code: "INVALID_MULTIPART" });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM imports").get(),
      ).toEqual({ count: 0 });
    }));

  it("treats the empty optional target emitted by an HTML form as omitted", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const form = new FormData();
      form.append(
        "file",
        new Blob(["PK streamed"], { type: "application/zip" }),
        "upload.zip",
      );
      form.append("target_book_id", "");
      const result = await storeMultipartImport({
        database,
        idempotencyKey: "multipart-empty-target-001",
        layout: dataRoot.layout,
        request: new Request("http://localhost/api/manage/imports", {
          body: form,
          method: "POST",
        }),
      });

      expect(result.import).toMatchObject({
        bookId: null,
        state: "uploaded",
      });
    }));
});
