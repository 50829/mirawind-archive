import type {
  NormalizedDocument,
  SemanticCompilationIdentity,
} from "../preparation/document-model";
import type { HeadingPresentation } from "./heading-presentation";
import type { BookDocument } from "../content/book-document.generated";

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

export interface BlockLinkIndex {
  readonly blockIds: ReadonlySet<string>;
}

export function createBlockLinkIndex(
  document: NormalizedDocument,
): BlockLinkIndex {
  return {
    blockIds: new Set(
      document.blocks.flatMap((block) =>
        block.blockId ? [block.blockId] : [],
      ),
    ),
  };
}

export function resolveBlockLinkTarget(
  index: BlockLinkIndex,
  value: string,
): string | undefined {
  return index.blockIds.has(value) ? value : undefined;
}

export interface CompiledBook {
  readonly book: BookDocument;
  readonly blockById: ReadonlyMap<string, NormalizedDocument["blocks"][number]>;
  readonly blockIds: readonly string[];
  readonly blockIndexById: ReadonlyMap<string, number>;
  readonly bookTitle: string;
  readonly document: NormalizedDocument;
  readonly headingByBlockId: ReadonlyMap<string, HeadingPresentation>;
  readonly blockLinkIndex: BlockLinkIndex;
  readonly headings: readonly HeadingPresentation[];
  readonly identity: SemanticCompilationIdentity;
  readonly pageByBlockId: ReadonlyMap<string, PagePlan>;
  readonly pageByHeadingId: ReadonlyMap<string, PagePlan>;
  readonly pageById: ReadonlyMap<number, PagePlan>;
  readonly pageMetadataById: ReadonlyMap<number, PageMetadata>;
  readonly pages: readonly PagePlan[];
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
  });
}
