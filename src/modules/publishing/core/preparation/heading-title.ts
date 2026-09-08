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
