import type {
  NormalizedDocument,
  SemanticCompilationIdentity,
} from "../preparation/document-model";
import type { HeadingPresentation } from "./heading-presentation";
import type { ValidatedDocumentConfig } from "./validate-config";

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

export interface HeadingLinkIndex {
  readonly blockIdBySlug: ReadonlyMap<string, string>;
  readonly blockIds: ReadonlySet<string>;
}

function headingSlug(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("en")
    .replaceAll(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replaceAll(/\s+/gu, "-")
    .replaceAll(/-+/gu, "-");
}

export function createHeadingLinkIndex(
  document: NormalizedDocument,
  presentations: ReadonlyMap<string, HeadingPresentation>,
): HeadingLinkIndex {
  const blockIds = new Set<string>();
  const blockIdBySlug = new Map<string, string>();
  for (const heading of document.headings) {
    blockIds.add(heading.blockId);
    const presentation = presentations.get(heading.blockId);
    for (const title of [
      heading.sourceTitle,
      ...(presentation ? [presentation.title, presentation.label] : []),
    ]) {
      const slug = headingSlug(title);
      if (slug && !blockIdBySlug.has(slug)) {
        blockIdBySlug.set(slug, heading.blockId);
      }
    }
  }
  return Object.freeze({ blockIdBySlug, blockIds });
}

export function resolveHeadingLinkTarget(
  index: HeadingLinkIndex,
  value: string,
): string | undefined {
  return index.blockIds.has(value)
    ? value
    : index.blockIdBySlug.get(headingSlug(value));
}

export interface CompiledBook {
  readonly blockById: ReadonlyMap<string, NormalizedDocument["blocks"][number]>;
  readonly blockIds: readonly string[];
  readonly blockIndexById: ReadonlyMap<string, number>;
  readonly bookTitle: string;
  readonly document: NormalizedDocument;
  readonly headingByBlockId: ReadonlyMap<string, HeadingPresentation>;
  readonly headingLinkIndex: HeadingLinkIndex;
  readonly headings: readonly HeadingPresentation[];
  readonly identity: SemanticCompilationIdentity;
  readonly pageByBlockId: ReadonlyMap<string, PagePlan>;
  readonly pageByHeadingId: ReadonlyMap<string, PagePlan>;
  readonly pageById: ReadonlyMap<number, PagePlan>;
  readonly pageMetadataById: ReadonlyMap<number, PageMetadata>;
  readonly pages: readonly PagePlan[];
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
