import type {
  NormalizedDocument,
  NormalizedHeading,
  TransientDocumentNode,
} from "./document-model";

export interface SourceHeadingTitle {
  readonly number: string | null;
  readonly title: string;
}

const sourceNumberPatterns = [
  /^(?<number>第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部))(?<separator>[\s:：、.．。-]*)/u,
  /^(?<number>附录\s*[A-Za-z0-9一二三四五六七八九十]+(?:\.\d+){0,3})(?<separator>[\s:：、.．。-]*)/iu,
  /^(?<number>(?:chapter|part|appendix)\s+[A-Za-z0-9IVXLCDM一二三四五六七八九十]+(?:\.\d+){0,3})(?<separator>[\s:：、.．。-]*)/iu,
  /^(?<number>(?:[A-Z]\.\d+(?:\.\d+){0,2}|\d+\.\d+(?:\.\d+){0,2}))(?<separator>[\s:：、]+)(?=[\p{L}“”'"（(*_~`[])/iu,
  /^(?<number>\d{1,3})(?<separator>\s+)(?=[\p{L}“”'"（(*_~`[])/u,
] as const;

export function splitSourceHeadingTitle(value: string): SourceHeadingTitle {
  for (const pattern of sourceNumberPatterns) {
    const match = pattern.exec(value);
    const number = match?.groups?.number;
    if (!match || !number) continue;
    return Object.freeze({
      number: number.trim().replaceAll(/\s+/gu, " "),
      title: value.slice(match[0].length).trimStart(),
    });
  }
  return Object.freeze({ number: null, title: value });
}

function rawHeadingMarkdown(
  document: NormalizedDocument,
  heading: NormalizedHeading,
): string {
  const node = document.blocks.find(
    (block) => block.blockId === heading.blockId && block.type === "heading",
  );
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error("HEADING_SOURCE_POSITION_MISSING");
  }
  return document.source
    .slice(start, end)
    .replace(/^\s{0,3}#{1,6}[\t ]+/u, "")
    .replace(/[\t ]+#+[\t ]*$/u, "")
    .trim();
}

function inlineVisibleText(node: TransientDocumentNode): string {
  if (
    (node.type === "text" ||
      node.type === "inlineCode" ||
      node.type === "inlineMath") &&
    node.value
  ) {
    return node.value;
  }
  if (node.type === "image" && node.alt) return node.alt;
  return (node.children ?? []).map(inlineVisibleText).join("");
}

interface InlineBoundary {
  readonly offset: number;
  readonly openings: readonly string[];
}

function locateInlineBoundary(
  node: TransientDocumentNode,
  visibleOffset: number,
  source: string,
): InlineBoundary | null {
  const position = node.position;
  if (!position) return null;
  const children = node.children ?? [];
  if (children.length > 0) {
    const firstChildStart = children[0]?.position?.start.offset;
    if (firstChildStart === undefined) return null;
    let remaining = visibleOffset;
    for (const child of children) {
      const childText = inlineVisibleText(child);
      if (remaining > childText.length) {
        remaining -= childText.length;
        continue;
      }
      const boundary = locateInlineBoundary(child, remaining, source);
      if (!boundary) return null;
      return Object.freeze({
        offset: boundary.offset,
        openings: Object.freeze([
          source.slice(position.start.offset, firstChildStart),
          ...boundary.openings,
        ]),
      });
    }
    return null;
  }

  const value = node.value ?? node.alt;
  if (value === undefined || visibleOffset > value.length) return null;
  const raw = source.slice(position.start.offset, position.end.offset);
  const valueStart = raw.indexOf(value);
  if (valueStart < 0) return null;
  return Object.freeze({
    offset: position.start.offset + valueStart + visibleOffset,
    openings: Object.freeze([raw.slice(0, valueStart)]),
  });
}

function stripParsedNumberPrefix(
  document: NormalizedDocument,
  heading: NormalizedHeading,
  visiblePrefixLength: number,
): string | null {
  const node = document.blocks.find(
    (block) => block.blockId === heading.blockId && block.type === "heading",
  );
  const children = node?.children ?? [];
  const contentEnd = children.at(-1)?.position?.end.offset;
  if (contentEnd === undefined) return null;
  let remaining = visiblePrefixLength;
  for (const child of children) {
    const childText = inlineVisibleText(child);
    if (remaining > childText.length) {
      remaining -= childText.length;
      continue;
    }
    const boundary = locateInlineBoundary(child, remaining, document.source);
    if (!boundary) return null;
    const markdown = `${boundary.openings.join("")}${document.source.slice(
      boundary.offset,
      contentEnd,
    )}`.trim();
    return markdown || null;
  }
  return null;
}

export function configuredHeadingTitle(input: {
  readonly document: NormalizedDocument;
  readonly heading: NormalizedHeading;
  readonly titleOverride?: string;
}): SourceHeadingTitle & { readonly markdown: string } {
  const visible = input.titleOverride ?? input.heading.sourceTitle;
  const split = splitSourceHeadingTitle(visible);
  if (input.titleOverride !== undefined) {
    return Object.freeze({
      markdown: split.title || visible,
      number: split.number,
      title: split.title || visible,
    });
  }
  const markdown = rawHeadingMarkdown(input.document, input.heading);
  const rawSplit = splitSourceHeadingTitle(markdown);
  const formattedTitle = split.number
    ? stripParsedNumberPrefix(
        input.document,
        input.heading,
        visible.length - split.title.length,
      )
    : null;
  const number = rawSplit.number ?? (formattedTitle ? split.number : null);
  return Object.freeze({
    markdown:
      (rawSplit.number ? rawSplit.title : null) || formattedTitle || markdown,
    number,
    title: number ? split.title || visible : visible,
  });
}
