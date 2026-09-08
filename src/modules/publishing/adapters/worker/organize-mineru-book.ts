import { createSafeDiagnostic, type SafeDiagnostic } from "@/domain/errors";
import type { InlineNode } from "../../core/content/book-document.generated";
import { contentEntries, inlineText } from "../../core/content/content-tree";
import { createRenderingDocument } from "../../core/content/rendering-document";
import { validateBookDocument } from "../../core/content/book-document";
import type { MineruContent } from "../../core/preparation/mineru-content";
import { splitSourceHeadingTitle } from "../../core/preparation/heading-title";
import { normalizeContentText } from "../../core/preparation/typography";
import { proposeDocumentStructure } from "../../core/preparation/structure-proposal";
import {
  recoverMineruContents,
  type PdfEvidenceReader,
} from "./recover-mineru-contents";

export type { PdfEvidenceReader } from "./recover-mineru-contents";

function trimPrefix(
  content: readonly InlineNode[],
  length: number,
): InlineNode[] {
  let remaining = length;
  return content.flatMap((node) => {
    const size = inlineText([node]).length;
    if (remaining >= size && remaining > 0) {
      remaining -= size;
      return [];
    }
    if (remaining === 0) return [node];
    const trim = remaining;
    remaining = 0;
    if (node.type === "text") return [{ ...node, text: node.text.slice(trim) }];
    if ("content" in node)
      return [{ ...node, content: trimPrefix(node.content, trim) }];
    return [node];
  });
}

export async function organizeMineruBook(input: {
  readonly imported: MineruContent;
  readonly sourcePath: string;
  readonly stagingDirectory: string;
  readonly signal?: AbortSignal;
  readonly typographyProfile?: "verbatim-v1" | "zh-smart-v2";
  readonly pdfEvidenceReader?: PdfEvidenceReader;
}) {
  const book = input.imported.book;
  const title = book.blocks.find((block) => block.type === "heading");
  if (title?.type === "heading")
    book.metadata.title =
      inlineText(title.content).trim().slice(0, 500) || "Untitled";
  const document = createRenderingDocument(book);
  const { layout, detection } = await recoverMineruContents({
    ...input,
    document,
    layout: input.imported.layout,
  });
  const diagnostics: SafeDiagnostic[] = [];
  const excluded = new Set(
    detection.candidates.flatMap(
      (candidate) => candidate.proposedRegion?.block_ids ?? [],
    ),
  );
  book.blocks = book.blocks.filter((block) => !excluded.has(block.id));
  const active = createRenderingDocument(book);
  const canonical = detection.candidates.find(
    (candidate) => candidate.canonical,
  );
  if (active.headings.length) {
    const bodySearchStartBlockId = canonical?.proposedRegion
      ? document.root.children
          ?.slice(canonical.endIndex + 1)
          .find(
            (block) =>
              block.type === "heading" &&
              block.blockId &&
              !excluded.has(block.blockId),
          )?.blockId
      : undefined;
    const proposal = proposeDocumentStructure(active, {
      ...(bodySearchStartBlockId ? { bodySearchStartBlockId } : {}),
      printedEntries: (canonical?.logicalEntries ?? []).map((entry) => ({
        ...(entry.bodyHeadingBlockId
          ? { bodyHeadingBlockId: entry.bodyHeadingBlockId }
          : {}),
        referenceLevel: entry.referenceLevel,
        sourceTitle: entry.sourceTitle,
      })),
    });
    const proposed = new Map(
      proposal.nodes.map((node) => [node.block_id, node]),
    );
    for (const { node } of contentEntries(book.blocks)) {
      if (!("type" in node) || node.type !== "heading") continue;
      const structure = proposed.get(node.id);
      if (!structure) throw new Error("CONTENT_HEADING_PROPOSAL_MISSING");
      node.level = structure.display_level;
      node.include_in_toc = structure.include_in_toc;
      node.starts_page = structure.starts_page;
      const visible = inlineText(node.content);
      const split = splitSourceHeadingTitle(visible);
      if (split.number && split.title.trim()) {
        node.source_number = split.number;
        node.content = trimPrefix(
          node.content,
          visible.length - split.title.length,
        );
      }
    }
    book.publishing.boundaries = { ...proposal.boundaries };
  } else {
    if (!book.blocks[0]) throw new Error("CONTENT_DOCUMENT_EMPTY");
    book.publishing.boundaries = { body_start_block_id: book.blocks[0].id };
  }
  let spaces = 0;
  let punctuation = 0;
  let protectedNodes = 0;
  function typography(content: InlineNode[]): void {
    for (const node of content) {
      if (node.type === "text") {
        const normalized = normalizeContentText(node.text);
        node.text = normalized.value;
        spaces += normalized.spacesNormalized;
        punctuation += normalized.punctuationConverted;
      } else if ("content" in node) typography(node.content);
      else if (node.type === "math" || node.type === "code") protectedNodes++;
    }
  }
  if (input.typographyProfile !== "verbatim-v1") {
    for (const { node } of contentEntries(book.blocks)) {
      if (!("type" in node)) continue;
      if (node.type === "heading" || node.type === "paragraph")
        typography(node.content);
      if ("caption" in node && node.caption) typography(node.caption);
    }
  }
  for (const candidate of detection.candidates)
    for (const item of candidate.diagnostics)
      diagnostics.push(
        createSafeDiagnostic({
          code: item.code,
          message: "Review the recovered contents entry.",
          severity: "warning",
          phase: "contents",
          ...(item.blockId ? { blockId: item.blockId } : {}),
        }),
      );
  return {
    book: validateBookDocument(book),
    analysis: {
      schema_version: 2,
      layout_source: layout.source,
      origins: input.imported.origins,
      removed_empty_blocks: input.imported.removedEmptyBlocks,
      removed_page_furniture: input.imported.removedPageFurniture,
      removed_block_ids: [...excluded],
      printed_contents: detection.candidates,
      typography: {
        profile: input.typographyProfile ?? "zh-smart-v2",
        spaces_normalized: spaces,
        punctuation_converted: punctuation,
        protected_nodes: protectedNodes,
      },
      diagnostics,
    },
  };
}
