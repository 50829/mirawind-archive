import type {
  NormalizedDocument,
  TransientDocumentNode,
} from "@/modules/publishing/core/preparation/document-model";
import type { NumberedHeading } from "@/modules/publishing/core/publication/numbering";

export interface CompiledDocumentPage {
  readonly alias?: string;
  readonly blockIds: readonly string[];
  readonly document: NormalizedDocument;
  readonly firstBlockId: string;
  readonly headingOverrides: ReadonlyMap<
    string,
    {
      readonly displayLevel: number;
      readonly displayTitle: string;
      readonly number: string | null;
    }
  >;
  readonly outputPath: string;
  readonly pageId: number;
  readonly title: string;
}

function pageDocument(
  document: NormalizedDocument,
  children: readonly TransientDocumentNode[],
  blocks: readonly TransientDocumentNode[],
): NormalizedDocument {
  return Object.freeze({
    blocks: Object.freeze(blocks),
    headings: document.headings,
    root: Object.freeze({
      ...document.root,
      children: Object.freeze(children),
    }),
    source: document.source,
  });
}

export function splitDocumentPages(input: {
  readonly bookTitle: string;
  readonly document: NormalizedDocument;
  readonly headings: readonly NumberedHeading[];
}): readonly CompiledDocumentPage[] {
  const children = input.document.root.children ?? [];
  if (children.length === 0 || input.document.blocks.length === 0) {
    throw new Error("DOCUMENT_HAS_NO_PUBLISHABLE_BLOCKS");
  }
  const headingById = new Map(
    input.headings.map((heading) => [heading.block_id, heading]),
  );
  const boundaries = [0];
  for (let index = 1; index < children.length; index += 1) {
    const child = children[index];
    if (
      child?.type === "heading" &&
      child.blockId &&
      headingById.get(child.blockId)?.starts_page
    ) {
      boundaries.push(index);
    }
  }
  boundaries.push(children.length);
  const headingOverrides = new Map(
    input.headings.map((heading) => [
      heading.block_id,
      Object.freeze({
        displayLevel: heading.display_level,
        displayTitle: heading.display_title,
        number: heading.number,
      }),
    ]),
  );
  const pages: CompiledDocumentPage[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startIndex = boundaries[index];
    const endIndex = boundaries[index + 1];
    if (startIndex === undefined || endIndex === undefined) continue;
    const pageChildren = children.slice(startIndex, endIndex);
    const startOffset =
      pageChildren[0]?.position?.start.offset ?? Number.NEGATIVE_INFINITY;
    const endOffset =
      index + 1 === boundaries.length - 1
        ? Number.POSITIVE_INFINITY
        : (children[endIndex]?.position?.start.offset ??
          Number.POSITIVE_INFINITY);
    const blocks = input.document.blocks.filter((block) => {
      const offset = block.position?.start.offset ?? Number.POSITIVE_INFINITY;
      return offset >= startOffset && offset < endOffset;
    });
    const blockIds = blocks.flatMap((block) =>
      block.blockId ? [block.blockId] : [],
    );
    const firstBlockId = blockIds[0];
    if (!firstBlockId) throw new Error("DOCUMENT_PAGE_HAS_NO_BLOCKS");
    const firstHeading = pageChildren.find(
      (node) => node.type === "heading" && node.blockId,
    );
    const configuredHeading = firstHeading?.blockId
      ? headingById.get(firstHeading.blockId)
      : undefined;
    const pageId = index + 1;
    pages.push(
      Object.freeze({
        ...(configuredHeading?.alias ? { alias: configuredHeading.alias } : {}),
        blockIds: Object.freeze(blockIds),
        document: pageDocument(input.document, pageChildren, blocks),
        firstBlockId,
        headingOverrides,
        outputPath: `published/pages/${pageId}.html`,
        pageId,
        title: configuredHeading?.display_title ?? input.bookTitle,
      }),
    );
  }
  return Object.freeze(pages);
}
