import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/compiler/document/manifest";
import { VersionRepository } from "@/db/repositories/versions";
import type { PublicationCrashPoint } from "@/jobs/crash-points";
import { finalizeBuiltPublication } from "@/jobs/handlers/build-publish";
import { publishReadyVersion } from "@/services/publication";
import { finalizeImmutableVersion } from "@/storage/finalize-version";

import { createTemporaryDataRoot } from "../../helpers/data-root.js";
import { withMigratedTestDatabase } from "../../helpers/database.js";
import {
  publicationTestLeaseOwner,
  publicationTestVersionId,
  setupPublicationFixture,
} from "./stale-build.test.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function stagedVersion(root: string, versionId: string): Promise<string> {
  const version = resolve(root, "version");
  await mkdir(resolve(version, "published", "pages"), {
    mode: 0o700,
    recursive: true,
  });
  const files = [
    { path: "book.yaml", value: "book: test\n" },
    { path: "document-manifest.json", value: "{}\n" },
    { path: "published/pages/1.html", value: "<main>test</main>\n" },
  ];
  for (const file of files) {
    await writeFile(resolve(version, file.path), file.value, { mode: 0o400 });
  }
  const marker = {
    book_id: 1,
    book_yaml_sha256: hash(files[0]?.value ?? ""),
    complete: true,
    compiler: {
      name: "mirawind-book-compiler",
      renderer_version: "semantic-html-v1",
      text_normalization_version: 1,
      version: "compiler-v1",
    },
    config_revision: 1,
    created_at: "2026-07-25T00:00:00.000Z",
    files: files.map((file) => ({
      path: file.path,
      sha256: hash(file.value),
      size: Buffer.byteLength(file.value),
    })),
    manifest_sha256: hash(files[1]?.value ?? ""),
    predecessor_version_id: null,
    schema_version: 1,
    source_id: "src_crash_boundary_test_0001",
    version_id: versionId,
  };
  await writeFile(resolve(version, "version.json"), canonicalJson(marker), {
    mode: 0o400,
  });
  return version;
}

async function stagedPublicationVersion(root: string): Promise<void> {
  const version = resolve(root, "version");
  await mkdir(resolve(version, "derived"), { mode: 0o700, recursive: true });
  await mkdir(resolve(version, "published", "pages"), {
    mode: 0o700,
    recursive: true,
  });
  await mkdir(resolve(version, "source"), { mode: 0o700, recursive: true });
  const source = "Body";
  const blockId = "blk_stale_publish_test_0001";
  const bookConfig = stringify(
    {
      book_id: 1,
      metadata: {},
      publishing: {
        code: { line_numbers: false },
        numbering: { mode: "normalized" },
      },
      revision: 1,
      schema_version: 1,
      source: {
        main_markdown: "book.md",
        main_markdown_sha256: hash(source),
        original_files: [],
      },
      structure: [
        {
          block_id: blockId,
          display_level: 1,
          include_in_toc: false,
          role: "body",
          starts_page: true,
        },
      ],
      title: "Book",
    },
    { lineWidth: 0 },
  );
  const manifest = {
    blocks: {
      [blockId]: {
        kind: "paragraph",
        normalized_visible_text: "Body",
        page_id: 1,
        resource_ids: [],
        source: {
          end: { column: 5, line: 1 },
          path: "source/book.md",
          start: { column: 1, line: 1 },
        },
        text_fingerprint: {
          algorithm: "sha256",
          normalization_version: 1,
          value: hash("Body"),
        },
      },
    },
    book_id: 1,
    compiler: {
      name: "mirawind-book-compiler",
      renderer_version: "semantic-html-v1",
      text_normalization_version: 1,
      version: "compiler-v1",
    },
    config_revision: 1,
    created_at: "2026-07-25T00:00:00.000Z",
    pages: [
      {
        block_ids: [blockId],
        first_block_id: blockId,
        output_path: "published/pages/1.html",
        page_id: 1,
        title: "Book",
      },
    ],
    resources: {},
    schema_version: 1,
    source_files: [
      { path: "source/book.md", sha256: hash(source), size: source.length },
    ],
    toc: [],
    version_id: publicationTestVersionId,
  };
  const spoolPayload = {
    ftsRows: [
      {
        authors: "",
        blockId,
        body: "Body",
        bookId: 1,
        heading: "",
        kind: "paragraph",
        ordinal: 0,
        pageId: 1,
        title: "Book",
        versionId: publicationTestVersionId,
      },
    ],
    schemaVersion: 1,
    shortRows: [
      {
        blockId: null,
        bookId: 1,
        kind: "title",
        normalizedText: "Book",
        ordinal: 0,
        pageId: 1,
        versionId: publicationTestVersionId,
      },
    ],
  };
  const spool = {
    ...spoolPayload,
    digest: hash(canonicalJson(spoolPayload)),
  };
  const values = new Map<string, string>([
    ["book.yaml", bookConfig],
    ["derived/search-spool.json", canonicalJson(spool)],
    ["document-manifest.json", canonicalJson(manifest)],
    ["published/pages/1.html", "<main>Body</main>\n"],
    ["source/book.md", source],
  ]);
  for (const [path, value] of values) {
    await mkdir(resolve(version, path, ".."), {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(resolve(version, path), value, { mode: 0o400 });
  }
  const marker = {
    book_id: 1,
    book_yaml_sha256: hash(values.get("book.yaml") ?? ""),
    complete: true,
    compiler: manifest.compiler,
    config_revision: 1,
    created_at: manifest.created_at,
    files: [...values]
      .map(([path, value]) => ({
        path,
        sha256: hash(value),
        size: Buffer.byteLength(value),
      }))
      .sort((left, right) =>
        Buffer.from(left.path).compare(Buffer.from(right.path)),
      ),
    manifest_sha256: hash(values.get("document-manifest.json") ?? ""),
    predecessor_version_id: null,
    schema_version: 1,
    source_id: "src_stale_publish_test_0001",
    version_id: publicationTestVersionId,
  };
  await writeFile(resolve(version, "version.json"), canonicalJson(marker), {
    mode: 0o400,
  });
  await writeFile(
    resolve(root, "version-build-result.json"),
    canonicalJson({
      bookId: 1,
      configRevision: 1,
      manifestSha256: marker.manifest_sha256,
      versionDirectory: "version",
      versionId: publicationTestVersionId,
    }),
    { mode: 0o400 },
  );
}

describe("publication crash boundaries", () => {
  it("leaves staging before rename and a complete orphan after rename", async () => {
    for (const point of [
      "before_fsync",
      "after_fsync_before_rename",
      "after_rename",
    ] as const) {
      const dataRoot = await createTemporaryDataRoot(`crash-${point}`);
      try {
        const versionId = `ver_crash_${point.replaceAll("_", "-")}_0000000001`;
        const staging = resolve(
          dataRoot.layout.temporaryDirectory,
          `staging-${point}`,
        );
        await mkdir(staging, { mode: 0o700 });
        await stagedVersion(staging, versionId);
        await expect(
          finalizeImmutableVersion({
            artifact: {
              bookId: 1,
              versionDirectory: "version",
              versionId,
            },
            crashPoint(crashPoint) {
              if (crashPoint === point) throw new Error(`CRASH:${point}`);
            },
            layout: dataRoot.layout,
            stagingDirectory: staging,
          }),
        ).rejects.toThrow(`CRASH:${point}`);
        const finalPath = resolve(
          dataRoot.layout.bookDirectory,
          "1",
          "versions",
          versionId,
        );
        if (point === "after_rename") {
          expect(
            JSON.parse(
              await readFile(resolve(finalPath, "version.json"), "utf8"),
            ).complete,
          ).toBe(true);
        } else {
          expect((await stat(resolve(staging, "version"))).isDirectory()).toBe(
            true,
          );
          await expect(stat(finalPath)).rejects.toMatchObject({
            code: "ENOENT",
          });
        }
      } finally {
        await dataRoot.cleanup();
      }
    }
  });

  it("exposes only the old or fully committed new pointer around cutover", async () => {
    for (const point of [
      "before_current_pointer",
      "after_current_pointer",
    ] as const satisfies readonly PublicationCrashPoint[]) {
      await withMigratedTestDatabase(async ({ database }) => {
        const fixture = setupPublicationFixture(database);
        await expect(
          publishReadyVersion({
            actorUserId: null,
            crashPoint(crashPoint) {
              if (crashPoint === point) throw new Error(`CRASH:${point}`);
            },
            database,
            jobId: fixture.publishJob.id,
            leaseOwner: publicationTestLeaseOwner,
            nowMs: 20,
            versionId: publicationTestVersionId,
          }),
        ).rejects.toThrow(`CRASH:${point}`);
        if (point === "before_current_pointer") {
          expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
            currentVersionId: null,
            visibility: "draft",
          });
          expect(
            new VersionRepository(database).require(publicationTestVersionId)
              .state,
          ).toBe("ready");
        } else {
          expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
            currentVersionId: publicationTestVersionId,
            visibility: "public",
          });
          expect(
            new VersionRepository(database).require(publicationTestVersionId)
              .state,
          ).toBe("published");
        }
      });
    }
  });

  it("keeps an orphan or ready row non-public around ready/search registration", async () => {
    for (const point of [
      "before_ready_search",
      "after_ready_search",
    ] as const satisfies readonly PublicationCrashPoint[]) {
      await withMigratedTestDatabase(async ({ database }, dataRoot) => {
        const fixture = setupPublicationFixture(database, {
          registerReady: false,
        });
        const staging = resolve(
          dataRoot.layout.temporaryDirectory,
          `ready-${point}`,
        );
        await mkdir(staging, { mode: 0o700 });
        await stagedPublicationVersion(staging);
        await expect(
          finalizeBuiltPublication({
            actorUserId: null,
            crashPoint(crashPoint) {
              if (crashPoint === point) throw new Error(`CRASH:${point}`);
            },
            database,
            jobId: fixture.publishJob.id,
            layout: dataRoot.layout,
            leaseOwner: publicationTestLeaseOwner,
            nowMs: 30,
            stagingDirectory: staging,
          }),
        ).rejects.toThrow(`CRASH:${point}`);
        expect(fixture.drafts.requireBook(fixture.book.id)).toMatchObject({
          currentVersionId: null,
          visibility: "draft",
        });
        const version = new VersionRepository(database).find(
          publicationTestVersionId,
        );
        if (point === "before_ready_search") expect(version).toBeNull();
        else expect(version?.state).toBe("ready");
      });
    }
  });
});
