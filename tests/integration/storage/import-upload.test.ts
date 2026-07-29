import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ImportUploadService } from "@/modules/publishing/adapters/filesystem/import-upload";

import { withMigratedTestDatabase } from "../../helpers/database.js";

async function* chunks(...values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

describe("durable import upload service", () => {
  it("streams, hashes, fsyncs and atomically indexes an upload and analysis job", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const service = new ImportUploadService(database, dataRoot.layout);
      const result = await service.store({
        bytes: chunks("PK", " test archive"),
        expiresAtMs: 20_000,
        idempotencyKey: "upload-key-00000001",
        nowMs: 10,
      });
      const finalPath = resolve(
        dataRoot.layout.root,
        result.import.uploadRelativePath,
      );

      expect(await readFile(finalPath, "utf8")).toBe("PK test archive");
      expect(result.import).toMatchObject({
        state: "uploaded",
        uploadSha256: createHash("sha256")
          .update("PK test archive")
          .digest("hex"),
        uploadSizeBytes: 15,
      });
      expect(result.job).toMatchObject({
        importId: result.import.id,
        kind: "analyze_import",
        state: "queued",
      });
      expect((await readdir(resolve(finalPath, ".."))).sort()).toEqual([
        "original.zip",
      ]);
    }));

  it("returns the first result without consuming a repeated idempotent body", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const service = new ImportUploadService(database, dataRoot.layout);
      const first = await service.store({
        bytes: chunks("first"),
        expiresAtMs: 20_000,
        idempotencyKey: "same-upload-key-0001",
        nowMs: 10,
      });
      const forbiddenBody: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw new Error("BODY_SHOULD_NOT_BE_CONSUMED");
            },
          };
        },
      };
      const repeated = await service.store({
        bytes: forbiddenBody,
        expiresAtMs: 30_000,
        idempotencyKey: "same-upload-key-0001",
        nowMs: 20,
      });

      expect(repeated).toEqual(first);
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM imports").get(),
      ).toEqual({ count: 1 });
      expect(await readdir(dataRoot.layout.uploadDirectory)).toHaveLength(1);
    }));

  it("enforces the actual byte limit while streaming and cleans partial output", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const service = new ImportUploadService(database, dataRoot.layout);

      await expect(
        service.store({
          bytes: chunks("123", "456"),
          expiresAtMs: 20_000,
          idempotencyKey: "oversize-key-000001",
          maximumBytes: 5,
          nowMs: 10,
        }),
      ).rejects.toMatchObject({ code: "UPLOAD_SIZE_LIMIT", status: 413 });
      expect(await readdir(dataRoot.layout.uploadDirectory)).toEqual([]);
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM imports").get(),
      ).toEqual({ count: 0 });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM jobs").get(),
      ).toEqual({ count: 0 });
    }));
});
