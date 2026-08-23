import type Database from "better-sqlite3";

import { acceptBookDeletion } from "@/modules/catalog/adapters/sqlite/book-deletion";
import { SqliteBookAccessRepository } from "@/modules/catalog/adapters/sqlite/book-access";
import { LibraryService } from "@/modules/catalog/adapters/sqlite/library";
import { setBookAccess } from "@/modules/catalog/application/commands/set-book-access";
import { SqliteBookPublishingCleanup } from "@/modules/publishing/adapters/sqlite/book-cleanup";

export function createCatalogServer(database: Database.Database) {
  const library = new LibraryService(database);
  const bookAccess = new SqliteBookAccessRepository(database);
  return Object.freeze({
    acceptBookDeletion: (
      input: Omit<
        Parameters<typeof acceptBookDeletion>[0],
        "database" | "deletionTasks" | "publishingCleanup"
      >,
    ) => {
      const publishingCleanup = new SqliteBookPublishingCleanup(database);
      return acceptBookDeletion({
        ...input,
        database,
        deletionTasks: publishingCleanup,
        publishingCleanup,
      });
    },
    administratorLibrary: library.administratorLibrary.bind(library),
    publicLibrary: library.publicLibrary.bind(library),
    resolveDetails: library.resolveDetails.bind(library),
    setBookAccess: (
      input: Omit<Parameters<typeof setBookAccess>[0], "books">,
    ) => setBookAccess({ ...input, books: bookAccess }),
  });
}
