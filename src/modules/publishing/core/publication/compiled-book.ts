import type {
  ConfirmedSourceRegion,
  NormalizedDocument,
  SemanticCompilationIdentity,
} from "@/modules/publishing/core/preparation/document-model";
import type { NumberedHeading } from "@/modules/publishing/core/publication/numbering";
import type { ValidatedDocumentConfig } from "@/modules/publishing/core/publication/validate-config";

export interface PageRange {
  readonly end: number;
  readonly start: number;
}

export interface PagePlan {
  readonly blockRange: PageRange;
  readonly firstBlockId: string;
  readonly pageId: number;
  readonly rootRange: PageRange;
}

export interface PageMetadata {
  readonly alias?: string;
  readonly title: string;
}

export interface HeadingOverride {
  readonly displayLevel: number;
  readonly displayTitle: string;
  readonly number: string | null;
}

export interface CompiledBook {
  readonly blockById: ReadonlyMap<string, NormalizedDocument["blocks"][number]>;
  readonly blockIds: readonly string[];
  readonly blockIndexById: ReadonlyMap<string, number>;
  readonly bookTitle: string;
  readonly document: NormalizedDocument;
  readonly excludedBlockIds: ReadonlySet<string>;
  readonly fullDocument: NormalizedDocument;
  readonly headingByBlockId: ReadonlyMap<string, NumberedHeading>;
  readonly headingOverrides: ReadonlyMap<string, HeadingOverride>;
  readonly headings: readonly NumberedHeading[];
  readonly identity: SemanticCompilationIdentity;
  readonly pageByBlockId: ReadonlyMap<string, PagePlan>;
  readonly pageByHeadingId: ReadonlyMap<string, PagePlan>;
  readonly pageById: ReadonlyMap<number, PagePlan>;
  readonly pageMetadataById: ReadonlyMap<number, PageMetadata>;
  readonly pages: readonly PagePlan[];
  readonly sourceRegions: readonly ConfirmedSourceRegion[];
  readonly validated: ValidatedDocumentConfig;
}

export function pageBlockIds(
  book: CompiledBook,
  page: PagePlan,
): readonly string[] {
  return book.blockIds.slice(page.blockRange.start, page.blockRange.end);
}

export function pageMetadata(book: CompiledBook, page: PagePlan): PageMetadata {
  const metadata = book.pageMetadataById.get(page.pageId);
  if (!metadata) throw new Error("COMPILED_BOOK_PAGE_METADATA_MISSING");
  return metadata;
}

export function pageOutputPath(page: PagePlan): string {
  return `published/pages/${page.pageId}.html`;
}

export function documentForPage(
  book: CompiledBook,
  page: PagePlan,
): NormalizedDocument {
  const roots = book.document.root.children ?? [];
  return Object.freeze({
    blocks: Object.freeze(
      book.document.blocks.slice(page.blockRange.start, page.blockRange.end),
    ),
    headings: book.document.headings,
    root: Object.freeze({
      ...book.document.root,
      children: Object.freeze(
        roots.slice(page.rootRange.start, page.rootRange.end),
      ),
    }),
    source: book.document.source,
  });
}
