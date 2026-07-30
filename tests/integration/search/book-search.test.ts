import { describe, expect, it } from "vitest";

import { normalizeSearchQuery } from "@/modules/reader/core/search-query";
import { BookSearchRepository } from "@/modules/reader/adapters/sqlite/book-search";

import { withMigratedTestDatabase } from "../../helpers/database.js";
import {
  publishReadyCandidateForTest,
  publicationTestVersionId,
  setupPublicationFixture,
} from "../../helpers/publication.js";

describe("current-version public book search", () => {
  it("uses a literal FTS phrase for Chinese, mixed, punctuation and formula text", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });
      database
        .prepare(
          `UPDATE search_fts
           SET body = '中文搜索 mixed x+y "quoted" wildcard *'
           WHERE version_id = ?`,
        )
        .run(publicationTestVersionId);
      const repository = new BookSearchRepository(database);
      const values = ["中文搜", "mixed", "x+y", '"quoted"', "wildcard *"];
      const matches = Object.fromEntries(
        values.map((value) => [
          value,
          repository.search({
            bookId: fixture.book.id,
            bookKey: String(fixture.book.id),
            limit: 20,
            offset: 0,
            query: normalizeSearchQuery(value),
            requirePublic: true,
            versionId: publicationTestVersionId,
          }),
        ]),
      );
      expect(matches).toEqual(
        Object.fromEntries(
          values.map((value) => [
            value,
            [
              expect.objectContaining({
                blockId: "blk_stale_publish_test_0001",
                kind: "body",
                pageId: 1,
              }),
            ],
          ]),
        ),
      );
      expect(() =>
        repository.search({
          bookId: fixture.book.id,
          bookKey: String(fixture.book.id),
          limit: 20,
          offset: 0,
          query: normalizeSearchQuery('" OR *'),
          requirePublic: true,
          versionId: publicationTestVersionId,
        }),
      ).not.toThrow();
    }));

  it("limits one or two characters to title, author and heading rows", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });
      expect(
        new BookSearchRepository(database).search({
          bookId: fixture.book.id,
          bookKey: String(fixture.book.id),
          limit: 20,
          offset: 0,
          query: normalizeSearchQuery("B"),
          requirePublic: true,
          versionId: publicationTestVersionId,
        }),
      ).toEqual([
        expect.objectContaining({
          blockId: "blk_stale_publish_test_0001",
          kind: "title",
          pageId: 1,
        }),
      ]);
    }));

  it("excludes private books and non-current version rows from anonymous search", () =>
    withMigratedTestDatabase(async ({ database }) => {
      const fixture = setupPublicationFixture(database);
      await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });
      database
        .prepare(
          `INSERT INTO search_fts (
             title, authors, heading, body, book_id, version_id,
             page_id, block_id, kind, ordinal
           ) VALUES ('Old', '', 'Old', 'old version secret', ?, ?, 1, ?, 'paragraph', 0)`,
        )
        .run(
          fixture.book.id,
          "ver_noncurrent_search_test_0001",
          "blk_noncurrent_search_test_0001",
        );
      const repository = new BookSearchRepository(database);
      expect(
        repository.search({
          bookId: fixture.book.id,
          bookKey: String(fixture.book.id),
          limit: 20,
          offset: 0,
          query: normalizeSearchQuery("old version"),
          requirePublic: true,
          versionId: publicationTestVersionId,
        }),
      ).toEqual([]);

      database
        .prepare("UPDATE books SET visibility = 'private' WHERE id = ?")
        .run(fixture.book.id);
      expect(
        repository.search({
          bookId: fixture.book.id,
          bookKey: String(fixture.book.id),
          limit: 20,
          offset: 0,
          query: normalizeSearchQuery("Body"),
          requirePublic: true,
          versionId: publicationTestVersionId,
        }),
      ).toEqual([]);
      expect(
        repository.search({
          bookId: fixture.book.id,
          bookKey: String(fixture.book.id),
          limit: 20,
          offset: 0,
          query: normalizeSearchQuery("Body"),
          requirePublic: false,
          versionId: publicationTestVersionId,
        }),
      ).toHaveLength(1);
    }));
});
