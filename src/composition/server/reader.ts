import type Database from "better-sqlite3";

import { PublishedBookService } from "@/modules/reader/adapters/filesystem/published-book";
import { BookSearchRepository } from "@/modules/reader/adapters/sqlite/book-search";
import type { StorageLayout } from "@/platform/filesystem/layout";

export function createReaderServer(database: Database.Database) {
  const search = new BookSearchRepository(database);
  return Object.freeze({ search: search.search.bind(search) });
}

export function createPublishedBookServer(
  database: Database.Database,
  layout: StorageLayout,
) {
  return new PublishedBookService(database, layout);
}
