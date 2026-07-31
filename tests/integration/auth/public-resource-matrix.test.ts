import { describe, expect, it } from "vitest";

import { SafeApplicationError } from "@/domain/errors";
import { authorizeBookResource } from "@/http/authorization/book-guard";
import { PublishedBookService } from "@/modules/reader/adapters/filesystem/published-book";

import { withMigratedTestDatabase } from "../../helpers/database.js";
import {
  publishReadyCandidateForTest,
  publicationTestVersionId,
  setupPublicationFixture,
} from "../../helpers/publication.js";

const anonymous = {
  allowed: false,
  reason: "UNAUTHENTICATED",
} as const;
const administrator = { allowed: true } as const;

describe("public/private current-version resolution matrix", () => {
  it("only exposes published or superseded version resources to an authorized audience", () => {
    for (const versionState of [
      "published",
      "superseded",
      "ready",
      "failed",
      "corrupt",
    ] as const) {
      for (const access of ["public", "private"] as const) {
        for (const [audience, decision] of [
          ["anonymous", anonymous],
          ["administrator", administrator],
        ] as const) {
          const result = authorizeBookResource({
            administrator: decision,
            exists: true,
            versionState,
            access,
          });
          const expected =
            (versionState === "published" || versionState === "superseded") &&
            (audience === "administrator" || access === "public");
          expect(result.allowed).toBe(expected);
          if (!expected) {
            expect(result).toMatchObject({
              cacheControl: "no-store",
              status: 404,
            });
          }
        }
      }
    }
  });

  it("allows anonymous public and administrator private reads while hiding private existence", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const fixture = setupPublicationFixture(database);
      await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });
      database
        .prepare("UPDATE books SET alias = 'matrix-book' WHERE id = ?")
        .run(fixture.book.id);
      const service = new PublishedBookService(database, dataRoot.layout);
      expect(service.resolveCurrent("matrix-book", anonymous)).toMatchObject({
        audience: "anonymous",
        versionId: publicationTestVersionId,
        access: "public",
      });

      database
        .prepare("UPDATE books SET access = 'private' WHERE id = ?")
        .run(fixture.book.id);
      expect(
        service.resolveCurrent(String(fixture.book.id), administrator),
      ).toMatchObject({
        audience: "administrator",
        versionId: publicationTestVersionId,
        access: "private",
      });
      expect(() => service.resolveCurrent("matrix-book", anonymous)).toThrow(
        expect.objectContaining<Partial<SafeApplicationError>>({
          code: "NOT_FOUND",
          status: 404,
        }),
      );
      expect(() => service.resolveCurrent("missing-book", anonymous)).toThrow(
        expect.objectContaining<Partial<SafeApplicationError>>({
          code: "NOT_FOUND",
          status: 404,
        }),
      );
    }));

  it("contains a broken current pointer as book-scoped unavailability", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const fixture = setupPublicationFixture(database);
      await publishReadyCandidateForTest({
        bookId: fixture.book.id,
        database,
        nowMs: 12,
      });
      database
        .prepare("UPDATE book_versions SET state = 'corrupt' WHERE id = ?")
        .run(publicationTestVersionId);
      expect(() =>
        new PublishedBookService(database, dataRoot.layout).resolveCurrent(
          String(fixture.book.id),
          anonymous,
        ),
      ).toThrow(
        expect.objectContaining<Partial<SafeApplicationError>>({
          code: "BOOK_UNAVAILABLE",
          status: 503,
        }),
      );
    }));
});
