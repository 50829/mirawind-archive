export type { BookVersionPresentation } from "@/modules/catalog/application/book-version-presentation";
export type {
  AdministratorLibraryEntry,
  AdministratorLibraryPage,
  BookDetails,
  PublicLibraryEntry,
  PublicLibraryView,
} from "@/modules/catalog/application/library-model";
export { deriveBookVersionPresentation } from "@/modules/catalog/application/derive-book-version-presentation";
export type {
  BookDeletionTaskPort,
  BookPublishingCleanupPort,
  BookRemovalInventory,
} from "@/modules/catalog/application/ports/book-publishing-cleanup";
