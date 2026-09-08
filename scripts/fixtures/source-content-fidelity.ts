import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type {
  BookDocument,
  ContentBlock,
} from "../../src/modules/publishing/core/content/book-document.generated.js";
import { blockText } from "../../src/modules/publishing/core/content/content-tree.js";
import type { ImportedBlockOrigin } from "../../src/modules/publishing/core/preparation/mineru-content.js";
import { anchorKey, type ReferenceAnchor } from "./mineru-reference.js";
import { sourceContentText } from "./create-mineru-reference-pack.js";

export interface SourceFidelityIssue {
  readonly code: string;
  readonly path: string;
}
export interface SourceFidelity {
  readonly checked_blocks: number;
  readonly checked_code: number;
  readonly checked_math: number;
  readonly issues: readonly SourceFidelityIssue[];
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function htmlText(value: string): string {
  function visit(node: DefaultTreeAdapterMap["node"]): string {
    if ("value" in node) return node.value;
    return "childNodes" in node ? node.childNodes.map(visit).join("") : "";
  }
  return visit(parseFragment(value));
}
function sourceText(type: string, content: Record<string, unknown>): string {
  const text = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(text).join("");
    if (typeof value === "string") return value;
    const node = object(value),
      raw = sourceContentText(node.content);
    return node.type === "text" &&
      /<(sub|sup|em|strong|b|i|u|s|del|span|code|a)\b[^>]*>[\s\S]*<\/\1\s*>|<(?:br|img)\b[^>]*>/iu.test(
        raw,
      )
      ? htmlText(
          raw.replace(
            /<(?!(?:\/?(?:sub|sup|em|strong|b|i|u|s|del|span|code|a)(?:\s[^<>]*)?\s*>|(?:br|img)(?:\s[^<>]*)?\/?>))/giu,
            "&lt;",
          ),
        )
      : raw;
  };
  switch (type) {
    case "title":
      return text(content.title_content);
    case "paragraph":
      return text(content.paragraph_content);
    case "code":
      return (
        text(content.code_caption) + sourceContentText(content.code_content)
      );
    case "algorithm":
      return (
        text(content.algorithm_caption) +
        sourceContentText(content.algorithm_content)
      );
    case "equation_interline":
      return sourceContentText(content.math_content);
    case "image":
    case "chart":
      return (
        text(content[type + "_caption"]) + text(content[type + "_footnote"])
      );
    case "table":
      return (
        text(content.table_caption) +
        htmlText(String(content.html ?? "")) +
        text(content.table_footnote)
      );
    case "list":
      return Array.isArray(content.list_items)
        ? content.list_items
            .map((item) => text(object(item).item_content))
            .join("")
        : "";
    case "page_footnote":
      return text(content.page_footnote_content);
    case "page_aside_text":
      return text(content.page_aside_text_content);
    default:
      return "";
  }
}
function normalizedText(value: string, title: boolean, table: boolean): string {
  const punctuation: Readonly<Record<string, string>> = {
    "，": ",",
    "。": ".",
    "；": ";",
    "：": ":",
    "？": "?",
    "！": "!",
    "（": "(",
    "）": ")",
    "“": '"',
    "”": '"',
    "‘": "'",
    "’": "'",
  };
  let normalized = value
    .normalize("NFC")
    .replaceAll("……", "...")
    .replace(/[，。；：？！（）“”‘’]/gu, (value) => punctuation[value] ?? value)
    .replace(/\s+/gu, "");
  if (title) normalized = normalized.replace(/[\p{P}\p{S}]/gu, "");
  if (table) normalized = normalized.replace(/\$/gu, "");
  return normalized;
}
function mathValues(value: unknown, source: boolean): string[] {
  if (Array.isArray(value))
    return value.flatMap((item) => mathValues(item, source));
  const record = object(value);
  if (source && record.type === "equation_inline")
    return [String(record.content ?? "")];
  if (!source && record.type === "math") return [String(record.latex ?? "")];
  return Object.values(record).flatMap((child) =>
    typeof child === "object" && child !== null
      ? mathValues(child, source)
      : [],
  );
}
function codeValues(block: ContentBlock): string[] {
  const result: string[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const record = object(value);
    if (record.type === "code") result.push(String(record.code ?? ""));
    for (const child of Object.values(record))
      if (child && typeof child === "object") visit(child);
  }
  visit(block);
  return result;
}
export function verifySourceContent(input: {
  readonly source: unknown;
  readonly book: BookDocument;
  readonly origins: readonly ImportedBlockOrigin[];
  readonly excludedBlockIds: ReadonlySet<string>;
}): SourceFidelity {
  if (
    !Array.isArray(input.source) ||
    input.source.some((page) => !Array.isArray(page))
  )
    throw new Error("SOURCE_FIDELITY_INPUT_INVALID");
  const origins = new Map(
    input.origins.map((origin) => [anchorKey(origin), origin]),
  );
  const blocks = new Map(input.book.blocks.map((block) => [block.id, block]));
  const issues: SourceFidelityIssue[] = [];
  const seenIds: string[] = [];
  let checkedBlocks = 0,
    checkedCode = 0,
    checkedMath = 0;
  const add = (code: string, anchor: ReferenceAnchor) =>
    issues.push({ code, path: "source/" + anchorKey(anchor) });
  for (const [page_index, page] of input.source.entries())
    for (const [source_index, item] of (page as unknown[]).entries()) {
      const raw = object(item),
        content = object(raw.content),
        type = String(raw.type),
        anchor = { page_index, source_index };
      if (["page_header", "page_footer", "page_number"].includes(type))
        continue;
      if (type === "title" && !sourceContentText(content.title_content).trim())
        continue;
      if (
        type === "list" &&
        Array.isArray(content.list_items) &&
        !content.list_items.length
      )
        continue;
      if (
        type === "table" &&
        !String(content.html ?? "").trim() &&
        object(content.image_source).path === "images/" &&
        content.table_nest_level === 1
      )
        continue;
      const origin = origins.get(anchorKey(anchor));
      if (!origin) {
        add("SOURCE_BLOCK_MISSING", anchor);
        continue;
      }
      if (input.excludedBlockIds.has(origin.block_id)) {
        if (blocks.has(origin.block_id)) add("EXCLUDED_BLOCK_RETAINED", anchor);
        continue;
      }
      const block = blocks.get(origin.block_id);
      if (!block) {
        add("SOURCE_BLOCK_MISSING", anchor);
        continue;
      }
      seenIds.push(block.id);
      checkedBlocks++;
      const actualText =
        block.type === "heading"
          ? [block.source_number, blockText(block)].filter(Boolean).join(" ")
          : blockText(block);
      if (
        normalizedText(
          sourceText(type, content),
          type === "title",
          type === "table",
        ) !== normalizedText(actualText, type === "title", type === "table")
      )
        add("SOURCE_TEXT_CHANGED", anchor);
      const sourceCode =
        type === "code"
          ? [sourceContentText(content.code_content)]
          : type === "algorithm"
            ? [sourceContentText(content.algorithm_content)]
            : [];
      if (sourceCode.length) {
        checkedCode += sourceCode.length;
        if (JSON.stringify(sourceCode) !== JSON.stringify(codeValues(block)))
          add("SOURCE_CODE_CHANGED", anchor);
      }
      if (type !== "table") {
        const formulaContent =
          type === "code"
            ? content.code_caption
            : type === "algorithm"
              ? content.algorithm_caption
              : content;
        const sourceMath =
          type === "equation_interline"
            ? [String(content.math_content ?? "")]
            : mathValues(formulaContent, true);
        checkedMath += sourceMath.length;
        if (
          JSON.stringify(sourceMath) !==
          JSON.stringify(mathValues(block, false))
        )
          add("SOURCE_MATH_CHANGED", anchor);
      }
    }
  if (
    JSON.stringify(seenIds) !==
    JSON.stringify(input.book.blocks.map((block) => block.id))
  )
    issues.push({ code: "SOURCE_BLOCK_ORDER_CHANGED", path: "blocks" });
  return {
    checked_blocks: checkedBlocks,
    checked_code: checkedCode,
    checked_math: checkedMath,
    issues,
  };
}
