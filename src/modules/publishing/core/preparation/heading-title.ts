import type {
  NormalizedDocument,
  NormalizedHeading,
} from "@/modules/publishing/core/preparation/document-model";

export interface SourceHeadingTitle {
  readonly number: string | null;
  readonly title: string;
}

const sourceNumberPatterns = [
  /^(?<number>第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部))(?<separator>[\s:：、.．。-]*)/u,
  /^(?<number>附录\s*[A-Za-z0-9一二三四五六七八九十]+(?:\.\d+){0,3})(?<separator>[\s:：、.．。-]*)/iu,
  /^(?<number>(?:chapter|part|appendix)\s+[A-Za-z0-9IVXLCDM一二三四五六七八九十]+(?:\.\d+){0,3})(?<separator>[\s:：、.．。-]*)/iu,
  /^(?<number>(?:[A-Z]\.\d+(?:\.\d+){0,2}|\d+\.\d+(?:\.\d+){0,2}))(?<separator>[\s:：、]*)(?=[\p{L}“”'"（(*_~`[])/iu,
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
  return Object.freeze({
    markdown: rawSplit.title || markdown,
    number: split.number,
    title: split.title || visible,
  });
}
