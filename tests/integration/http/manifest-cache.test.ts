import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { publishReadyVersion } from "@/services/publication";
import {
  PublishedBookService,
  resetPublishedManifestCacheForTests,
} from "@/services/published-book";

import { withMigratedTestDatabase } from "../../helpers/database.js";
import {
  publicationTestLeaseOwner,
  publicationTestVersionId,
  setupPublicationFixture,
} from "../publication/stale-build.test.js";

const anonymous = {
  allowed: false,
  reason: "UNAUTHENTICATED",
} as const;
const blockId = "blk_manifest_cache_test_0001";

function manifest(bookId: number): Readonly<Record<string, unknown>> {
  return {
    blocks: {
      [blockId]: {
        kind: "heading",
        normalized_visible_text: "Chapter",
        page_id: 1,
        resource_ids: [],
        source: {
          end: { column: 10, line: 1 },
          path: "source/book.md",
          start: { column: 1, line: 1 },
        },
        text_fingerprint: {
          algorithm: "sha256",
          normalization_version: 1,
          value: "b".repeat(64),
        },
      },
    },
    book_id: bookId,
    compiler: {
      name: "mirawind-book-compiler",
      renderer_version: "semantic-html-v4-katex-0.18.1",
      text_normalization_version: 1,
      version: "compiler-v4",
    },
    config_revision: 1,
    created_at: "2026-07-24T00:00:00.000Z",
    pages: [
      {
        block_ids: [blockId],
        first_block_id: blockId,
        output_path: "published/pages/1.html",
        page_id: 1,
        title: "Chapter",
      },
    ],
    resources: {},
    schema_version: 2,
    source_files: [
      {
        path: "source/book.md",
        sha256: "c".repeat(64),
        size: 10,
      },
    ],
    toc: [
      {
        block_id: blockId,
        level: 1,
        number: "1",
        page_id: 1,
        role: "body",
        title: "Chapter",
      },
    ],
    version_id: publicationTestVersionId,
  };
}

describe("immutable published manifest cache", () => {
  beforeEach(resetPublishedManifestCacheForTests);
  afterEach(resetPublishedManifestCacheForTests);

  it("reuses a validated immutable manifest and misses when its database hash changes", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const fixture = setupPublicationFixture(database);
      await publishReadyVersion({
        actorUserId: null,
        database,
        jobId: fixture.publishJob.id,
        leaseOwner: publicationTestLeaseOwner,
        nowMs: 12,
        versionId: publicationTestVersionId,
      });
      const versionDirectory = resolve(
        dataRoot.layout.root,
        "books",
        String(fixture.book.id),
        "versions",
        publicationTestVersionId,
      );
      await mkdir(versionDirectory, { mode: 0o700, recursive: true });
      const manifestPath = resolve(versionDirectory, "document-manifest.json");
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest(fixture.book.id))}\n`,
        { mode: 0o600 },
      );
      const service = new PublishedBookService(database, dataRoot.layout);
      const input = {
        administrator: anonymous,
        bookKey: String(fixture.book.id),
        pageKey: "1",
      };

      await expect(service.resolvePage(input)).resolves.toMatchObject({
        pageId: 1,
        versionId: publicationTestVersionId,
      });
      await writeFile(manifestPath, "{invalid", { mode: 0o600 });
      await expect(service.resolvePage(input)).resolves.toMatchObject({
        pageId: 1,
        versionId: publicationTestVersionId,
      });

      database
        .prepare("UPDATE book_versions SET manifest_sha256 = ? WHERE id = ?")
        .run("d".repeat(64), publicationTestVersionId);
      await expect(service.resolvePage(input)).rejects.toMatchObject({
        code: "BOOK_UNAVAILABLE",
        status: 503,
      });
    }));
});
