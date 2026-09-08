import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { storeMultipartImport } from "@/http/multipart/import-form";
import { m1ImportExpiryMs } from "@/modules/publishing/application/publishing-api";

import { withMigratedTestDatabase } from "../../helpers/database.js";

describe("streaming multipart import form", () => {
  it("accepts exactly one ZIP stream for a new book", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const form = new FormData();
      form.append(
        "file",
        new Blob(["PK streamed"], { type: "application/zip" }),
        "unsafe/../upload.zip",
      );
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
        bookId: null,
        expiresAtMs: m1ImportExpiryMs,
        originalName: "upload.zip",
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

  it("rejects an extra field after the file without leaving an upload", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const form = new FormData();
      form.append(
        "file",
        new Blob(["PK streamed"], { type: "application/zip" }),
        "upload.zip",
      );
      form.append("target_book_id", "");
      await expect(
        storeMultipartImport({
          database,
          idempotencyKey: "multipart-empty-target-001",
          layout: dataRoot.layout,
          request: new Request("http://localhost/api/manage/imports", {
            body: form,
            method: "POST",
          }),
        }),
      ).rejects.toMatchObject({ code: "INVALID_MULTIPART" });
      expect(await readdir(dataRoot.layout.uploadDirectory)).toEqual([]);
    }));

  it("rejects a truncated multipart stream and completes cleanup", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      await expect(
        storeMultipartImport({
          database,
          layout: dataRoot.layout,
          idempotencyKey: "truncated-multipart-001",
          request: new Request("http://localhost/api/manage/imports", {
            method: "POST",
            headers: {
              "Content-Type": "multipart/form-data; boundary=fixture",
            },
            body: '--fixture\r\nContent-Disposition: form-data; name="file"; filename="book.zip"\r\nContent-Type: application/zip\r\n\r\nPK incomplete',
          }),
        }),
      ).rejects.toMatchObject({ code: "INVALID_MULTIPART" });
      expect(await readdir(dataRoot.layout.uploadDirectory)).toEqual([]);
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM imports").get(),
      ).toEqual({ count: 0 });
    }));
});
