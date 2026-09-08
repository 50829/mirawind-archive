import { extname } from "node:path";
import { parseTableHtml } from "../content/table-html";
import { parseFragment } from "parse5";
import { inlineFromHtmlNodes } from "../content/inline-html";

import { SafeApplicationError } from "@/domain/errors";
import { createOpaqueId } from "@/domain/ids";
import { hasControlCharacters } from "@/domain/text";
import type {
  BookDocument,
  BookResource,
  ContentBlock,
  InlineNode,
} from "../content/book-document.generated";
import { inlineText, blockText } from "../content/content-tree";
import type { LayoutEvidence, LayoutEvidenceRecord } from "./layout-evidence";

export interface ImportedBlockOrigin {
  readonly block_id: string;
  readonly page_index: number;
  readonly source_type: string;
  readonly source_index: number;
  readonly bbox?: readonly [number, number, number, number];
}

export interface MineruContent {
  readonly book: BookDocument;
  readonly layout: LayoutEvidence;
  readonly origins: readonly ImportedBlockOrigin[];
  readonly removedPageFurniture: number;
  readonly removedEmptyBlocks: number;
}

function invalid(): never {
  throw new SafeApplicationError(
    "MINERU_CONTENT_UNSUPPORTED",
    "The MinerU content-list v2 document contains unsupported or malformed content.",
    400,
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 4194304) invalid();
  return value;
}

function mineruInline(
  value: unknown,
  resourceIdForPath: (path: string) => string,
): InlineNode[] {
  if (!Array.isArray(value)) invalid();
  return value.flatMap((item): InlineNode[] => {
    const node = record(item);
    if (node.type === "text") {
      const value = text(node.content);
      if (
        /<(sub|sup|em|strong|b|i|u|s|del|span|code|a)\b[^>]*>[\s\S]*<\/\1\s*>|<(?:br|img)\b[^>]*>/iu.test(
          value,
        )
      ) {
        const html = value.replace(
          /<(?!(?:\/?(?:sub|sup|em|strong|b|i|u|s|del|span|code|a)(?:\s[^<>]*)?\s*>|(?:br|img)(?:\s[^<>]*)?\/?>))/giu,
          "&lt;",
        );
        return inlineFromHtmlNodes(
          parseFragment(html).childNodes,
          resourceIdForPath,
        );
      }
      return [{ type: "text", text: value }];
    }
    if (node.type === "equation_inline")
      return [{ type: "math", latex: text(node.content) }];
    invalid();
  });
}
function literalContent(value: unknown): string {
  if (!Array.isArray(value)) invalid();
  return value
    .map((item) => {
      const node = record(item);
      if (node.type !== "text" && node.type !== "equation_inline") invalid();
      return text(node.content);
    })
    .join("");
}
function paragraph(content: InlineNode[]): ContentBlock {
  return { id: createOpaqueId("block"), type: "paragraph", content };
}
export function importMineruContent(
  value: unknown,
  input: {
    readonly bookId: number;
    readonly nowMs: number;
    readonly title: string;
  },
): MineruContent {
  if (
    !Array.isArray(value) ||
    value.length > 100000 ||
    !value.every(Array.isArray)
  )
    invalid();
  const resources = new Map<string, BookResource>();
  const origins: ImportedBlockOrigin[] = [];
  const records: LayoutEvidenceRecord[] = [];
  let removedPageFurniture = 0;
  let removedEmptyBlocks = 0;
  const blocks: ContentBlock[] = [];
  function resource(pathInput: unknown): string {
    const path = text(pathInput);
    if (
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      hasControlCharacters(path) ||
      /^[a-z][a-z0-9+.-]*:/iu.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      path.normalize("NFC") !== path
    )
      invalid();
    const existing = resources.get(path);
    if (existing) return existing.id;
    const extension = extname(path).toLowerCase();
    const mediaTypes: Readonly<Record<string, string>> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".avif": "image/avif",
    };
    const mediaType = mediaTypes[extension];
    if (!mediaType) invalid();
    const result = {
      id: createOpaqueId("resource"),
      path,
      media_type: mediaType,
    };
    resources.set(path, result);
    return result.id;
  }
  const inlines = (value: unknown) => mineruInline(value, resource);
  const notes = (value: unknown): ContentBlock[] => {
    if (value === undefined) return [];
    const content = inlines(value);
    return content.length ? [paragraph(content)] : [];
  };
  for (const [pageIndex, page] of value.entries()) {
    if (!Array.isArray(page) || page.length > 20000) invalid();
    for (const [sourceIndex, raw] of page.entries()) {
      const node = record(raw);
      const type = text(node.type);
      const content = record(node.content);
      const coordinates = node.bbox;
      const bbox =
        Array.isArray(coordinates) &&
        coordinates.length === 4 &&
        coordinates.every(
          (item) => typeof item === "number" && Number.isFinite(item),
        )
          ? (coordinates as [number, number, number, number])
          : undefined;
      if (node.bbox !== undefined && !bbox) invalid();
      const id = createOpaqueId("block");
      let block: ContentBlock;
      switch (type) {
        case "page_header":
        case "page_footer":
        case "page_number": {
          const field = `${type}_content`;
          const label = inlineText(inlines(content[field]));
          records.push({
            pageIndex,
            type: type === "page_number" ? "page-label" : type,
            text: label,
            ...(bbox ? { bbox } : {}),
          });
          removedPageFurniture++;
          continue;
        }
        case "title": {
          if (
            !Number.isSafeInteger(content.level) ||
            Number(content.level) < 1 ||
            Number(content.level) > 20
          )
            invalid();
          const title = inlines(content.title_content);
          if (!inlineText(title).trim()) {
            removedEmptyBlocks++;
            continue;
          }
          block = {
            id,
            type: "heading",
            level: Math.min(4, Number(content.level)),
            content: title,
            include_in_toc: true,
            starts_page: Number(content.level) === 1,
            exclude_from_numbering: false,
          };
          break;
        }
        case "paragraph":
          block = {
            id,
            type: "paragraph",
            content: inlines(content.paragraph_content),
          };
          break;
        case "equation_interline":
          if (content.math_type !== "latex") invalid();
          block = { id, type: "math", latex: text(content.math_content) };
          break;
        case "code":
          block = {
            id,
            type: "code",
            code: literalContent(content.code_content),
            language:
              content.code_language === undefined
                ? "text"
                : text(content.code_language),
            caption: inlines(content.code_caption ?? []),
          };
          break;
        case "algorithm":
          block = {
            id,
            type: "container",
            kind: "algorithm",
            content: [
              ...notes(content.algorithm_caption),
              {
                id: createOpaqueId("block"),
                type: "code",
                language: "text",
                code: literalContent(content.algorithm_content),
              },
            ],
          };
          break;
        case "image":
        case "chart":
          block = {
            id,
            type: "image",
            resource_id: resource(record(content.image_source).path),
            alt: "",
            caption: inlines(content[`${type}_caption`] ?? []),
            notes: notes(content[`${type}_footnote`]),
          };
          break;
        case "table": {
          const html = text(content.html);
          const caption = inlines(content.table_caption ?? []);
          // MinerU emits empty nested-table placeholders alongside the complete parent table.
          if (
            !html.trim() &&
            record(content.image_source).path === "images/" &&
            !caption.length &&
            !inlines(content.table_footnote ?? []).length &&
            content.table_nest_level === 1
          ) {
            removedEmptyBlocks++;
            continue;
          }
          if (!html.trim()) {
            block = {
              id,
              type: "image",
              resource_id: resource(record(content.image_source).path),
              alt: inlineText(caption),
              caption,
              notes: notes(content.table_footnote),
            };
          } else {
            block = {
              id,
              type: "table",
              rows: parseTableHtml(html, resource, true),
              caption,
              notes: notes(content.table_footnote),
            };
          }
          break;
        }
        case "list": {
          if (!Array.isArray(content.list_items)) invalid();
          if (!content.list_items.length) {
            removedEmptyBlocks++;
            continue;
          }
          const items = content.list_items.map((rawItem) => {
            const item = record(rawItem);
            if (item.item_type !== "text") invalid();
            return {
              id: createOpaqueId("block"),
              content: [paragraph(inlines(item.item_content))],
            };
          });
          block = { id, type: "list", ordered: false, items };
          for (const [itemIndex, item] of items.entries())
            records.push({
              groupId: blocks.length,
              groupItemIndex: itemIndex,
              groupItemCount: items.length,
              sourceOrder: records.length,
              pageIndex,
              type: "list",
              text: item.content.map(blockText).join("\n"),
              ...(bbox ? { groupBbox: bbox } : {}),
            });
          break;
        }
        case "page_footnote":
        case "page_aside_text":
          block = {
            id,
            type: "container",
            kind: type === "page_footnote" ? "note" : "aside",
            content: [paragraph(inlines(content[`${type}_content`]))],
          };
          break;
        default:
          invalid();
      }
      origins.push({
        block_id: id,
        page_index: pageIndex,
        source_type: type,
        source_index: sourceIndex,
        ...(bbox ? { bbox } : {}),
      });
      if (type !== "list")
        records.push({
          pageIndex,
          type: "text",
          text: blockText(block),
          sourceOrder: records.length,
          ...(block.type === "heading" ? { textLevel: block.level } : {}),
          ...(bbox ? { bbox } : {}),
        });
      blocks.push(block);
      if (blocks.length > 20000) invalid();
    }
  }
  if (!blocks.length) invalid();
  const first = blocks[0];
  if (!first) invalid();
  return {
    book: {
      schema_version: 1,
      book_id: input.bookId,
      updated_at: input.nowMs,
      metadata: { title: input.title },
      publishing: {
        numbering: "source",
        code: { line_numbers: false },
        boundaries: { body_start_block_id: first.id },
      },
      blocks,
      resources: [...resources.values()],
    },
    layout: { source: "content-list", diagnostics: [], records },
    origins,
    removedPageFurniture,
    removedEmptyBlocks,
  };
}
