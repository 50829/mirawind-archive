import { describe, expect, it } from "vitest";

import { BookPresentationRepository } from "@/modules/catalog/adapters/sqlite/book-presentations";
import { reconcileBookVersionPresentations } from "@/modules/catalog/adapters/filesystem/book-presentation";

import { withMigratedTestDatabase } from "../../helpers/database.js";
import {
  publicationTestVersionId,
  setupPublicationFixture,
} from "../../helpers/publication.js";

describe("book presentation reconciliation", () => {
  it("rebuilds a missing projection idempotently off the request path", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      setupPublicationFixture(database);
      const repository = new BookPresentationRepository(database);
      const expected = repository.require(publicationTestVersionId);
      repository.delete(publicationTestVersionId);

      const first = await reconcileBookVersionPresentations({
        database,
        layout: dataRoot.layout,
        loadPresentation: async () => expected,
        nowMs: 20,
      });
      expect(first).toMatchObject({
        mismatchedVersionIds: [],
        repairedCurrentBookIds: [],
        rebuiltVersionIds: [publicationTestVersionId],
      });
      expect(
        repository.require(publicationTestVersionId).projectionSha256,
      ).toBe(expected.projectionSha256);

      const second = await reconcileBookVersionPresentations({
        database,
        layout: dataRoot.layout,
        loadPresentation: async () => expected,
        nowMs: 21,
      });
      expect(second).toMatchObject({
        mismatchedVersionIds: [],
        repairedCurrentBookIds: [],
        rebuiltVersionIds: [],
      });
    }));

  it("reports a digest mismatch without mutating the stored projection", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      setupPublicationFixture(database);
      const repository = new BookPresentationRepository(database);
      const stored = repository.require(publicationTestVersionId);

      const result = await reconcileBookVersionPresentations({
        database,
        layout: dataRoot.layout,
        loadPresentation: async () => ({
          ...stored,
          projectionSha256: "f".repeat(64),
        }),
        nowMs: 20,
      });
      expect(result.mismatchedVersionIds).toEqual([publicationTestVersionId]);
      expect(
        repository.require(publicationTestVersionId).projectionSha256,
      ).toBe(stored.projectionSha256);
    }));
});
