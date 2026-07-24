import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { buildImmutableVersion } from "@/compiler/version-builder";
import {
  validateDocumentManifest,
  validateVersionMarker,
} from "@/schemas/document-manifest";
import { finalizeImmutableVersion } from "@/storage/finalize-version";

import { createTemporaryDataRoot } from "../../helpers/data-root.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const versionId = "ver_version_builder_test_0001";
const sourceId = "src_version_builder_test_0001";
const headingId = "blk_version_builder_heading_0001";

async function treeHashes(root: string): Promise<readonly string[]> {
  const values: string[] = [];
  const visit = async (directory: string, prefix = ""): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      const relativePath = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(path, `${relativePath}/`);
      else {
        values.push(
          `${relativePath}:${createHash("sha256")
            .update(await readFile(path))
            .digest("hex")}`,
        );
      }
    }
  };
  await visit(root);
  return values;
}

describe("complete immutable version construction", () => {
  it("rebuilds deterministically, validates closure and finalizes read-only", async () => {
    const dataRoot = await createTemporaryDataRoot("version-builder");
    try {
      const bookId = 1;
      const draftRoot = resolve(
        dataRoot.layout.bookDirectory,
        String(bookId),
        "draft",
      );
      const sourceRoot = resolve(draftRoot, "sources", sourceId);
      await mkdir(resolve(sourceRoot, "images"), {
        mode: 0o700,
        recursive: true,
      });
      const markdown = '# Chapter\n\n![Pixel](images/pixel.png "Pixel")';
      await writeFile(resolve(sourceRoot, "book.md"), markdown, {
        mode: 0o400,
      });
      await writeFile(resolve(sourceRoot, "images", "pixel.png"), png, {
        mode: 0o400,
      });
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
          main_markdown_sha256: createHash("sha256")
            .update(markdown)
            .digest("hex"),
          original_files: [],
        },
        structure: [
          {
            block_id: headingId,
            display_level: 1,
            include_in_toc: true,
            role: "body",
            starts_page: true,
          },
        ],
        title: "Version test",
      };
      const configPath = resolve(draftRoot, "configs", "1", "book.yaml");
      await mkdir(resolve(configPath, ".."), { mode: 0o700, recursive: true });
      await writeFile(configPath, stringify(config, { lineWidth: 0 }), {
        mode: 0o400,
      });
      const stagingA = resolve(dataRoot.layout.temporaryDirectory, "build-a");
      const stagingB = resolve(dataRoot.layout.temporaryDirectory, "build-b");
      const input = {
        bookId,
        configRevision: 1,
        configYamlPath: configPath,
        createdAtMs: 1_753_315_200_000,
        draftRoot,
        predecessorVersionId: null,
        sourceId,
        sourceRoot,
        versionId,
      };
      const first = await buildImmutableVersion({
        ...input,
        stagingDirectory: stagingA,
      });
      await buildImmutableVersion({
        ...input,
        stagingDirectory: stagingB,
      });
      expect(await treeHashes(resolve(stagingA, "version"))).toEqual(
        await treeHashes(resolve(stagingB, "version")),
      );
      const tamperedPage = resolve(
        stagingB,
        "version",
        "published",
        "pages",
        "1.html",
      );
      await chmod(tamperedPage, 0o600);
      await writeFile(tamperedPage, "tampered");
      await expect(
        finalizeImmutableVersion({
          artifact: first,
          layout: dataRoot.layout,
          stagingDirectory: stagingB,
        }),
      ).rejects.toThrow("VERSION_FILE_INTEGRITY_MISMATCH");

      const marker = validateVersionMarker(
        JSON.parse(
          await readFile(resolve(stagingA, "version", "version.json"), "utf8"),
        ),
      );
      const manifest = validateDocumentManifest(
        JSON.parse(
          await readFile(
            resolve(stagingA, "version", "document-manifest.json"),
            "utf8",
          ),
        ),
      );
      expect(marker).toMatchObject({ complete: true, version_id: versionId });
      expect(manifest).toMatchObject({
        book_id: bookId,
        version_id: versionId,
      });
      expect(manifest.resources as Record<string, unknown>).not.toEqual({});

      const finalPath = await finalizeImmutableVersion({
        artifact: first,
        layout: dataRoot.layout,
        stagingDirectory: stagingA,
      });
      expect(finalPath).toBe(
        resolve(
          dataRoot.layout.bookDirectory,
          String(bookId),
          "versions",
          versionId,
        ),
      );
      expect((await stat(finalPath)).mode & 0o777).toBe(0o500);
      expect(
        (await stat(resolve(finalPath, "version.json"))).mode & 0o777,
      ).toBe(0o400);
    } finally {
      await dataRoot.cleanup();
    }
  });
});
