import { open, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonDocument } from "@/modules/publishing/adapters/filesystem/read-json-document";
import { contentLimits } from "@/modules/publishing/core/content/book-document";
import { atomicWriteFile } from "@/platform/filesystem/atomic-file";
import { createTemporaryDataRoot } from "../../helpers/data-root";

describe("bounded structured document reads", () => {
  it("preserves JSON values and rejects malformed UTF-8, duplicate keys, prototype keys and excessive nesting", async () => {
    const root = await createTemporaryDataRoot("ir-json");
    const path = resolve(root.path, "book.json");
    try {
      const value = {
        text: "中文 \u0000",
        items: [{ value: 1 }, { value: 2 }],
      };
      await atomicWriteFile(path, JSON.stringify(value), { mode: 0o600 });
      expect(await readJsonDocument(path)).toEqual(value);
      for (const input of [
        Buffer.from([0x22, 0xff, 0x22]),
        '{"title":"first","title":"second"}',
        '{"__proto__":{"type":"text"}}',
        "[".repeat(129) + "0" + "]".repeat(129),
        JSON.stringify("x".repeat(contentLimits.blockBytes + 1)),
      ]) {
        await atomicWriteFile(path, input, { mode: 0o600 });
        await expect(readJsonDocument(path)).rejects.toMatchObject({
          code: "CONTENT_JSON_INVALID",
        });
      }
    } finally {
      await root.cleanup();
    }
  });
  it("rejects symlinks, oversized files and canceled reads", async () => {
    const root = await createTemporaryDataRoot("ir-json");
    const path = resolve(root.path, "book.json");
    try {
      await atomicWriteFile(path, "[]", { mode: 0o600 });
      await symlink(path, resolve(root.path, "link.json"));
      await expect(
        readJsonDocument(resolve(root.path, "link.json")),
      ).rejects.toMatchObject({ code: "CONTENT_FILE_INVALID" });
      const controller = new AbortController();
      controller.abort();
      await expect(
        readJsonDocument(path, controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      const handle = await open(path, "w");
      try {
        await handle.truncate(contentLimits.bytes + 1);
      } finally {
        await handle.close();
      }
      await expect(readJsonDocument(path)).rejects.toMatchObject({
        code: "CONTENT_FILE_INVALID",
      });
    } finally {
      await root.cleanup();
    }
  });
});
