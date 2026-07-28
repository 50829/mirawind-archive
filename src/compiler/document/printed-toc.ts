import { createHash } from "node:crypto";

import { createOpaqueId } from "../../domain/ids.js";
import {
  reconstructPrintedLayoutRows,
  type LayoutEvidence,
} from "./layout-evidence.js";
import { utf8ByteOffset } from "./source-regions.js";
import type {
  ConfirmedSourceRegion,
  NormalizedDocument,
  NormalizedHeading,
  TransientDocumentNode,
} from "./types.js";

export interface PrintedContentsDiagnostic {
  readonly blockId?: string;
  readonly code:
    | "PRINTED_TOC_AMBIGUOUS_MATCH"
    | "PRINTED_TOC_INSUFFICIENT_ENTRIES"
    | "PRINTED_TOC_LEVEL_GAP"
    | "PRINTED_TOC_LOW_COVERAGE"
    | "PRINTED_TOC_RICH_CONTENT"
    | "PRINTED_TOC_UNMATCHED_ENTRY";
  readonly path: string;
}

export interface PrintedContentsCandidate {
  readonly alignment: {
    readonly bestScore: number;
    readonly margin: number;
    readonly secondBestScore: number;
  };
  readonly boundaryConfidence: "high" | "low" | "medium";
  readonly canonical: boolean;
  readonly confidence: "high" | "low" | "medium";
  readonly diagnostics: readonly PrintedContentsDiagnostic[];
  readonly endByte: number;
  readonly entryCount: number;
  readonly logicalEntries: readonly PrintedContentsLogicalEntry[];
  readonly matchedHeadingCount: number;
  readonly matchConfidence: "high" | "low" | "medium";
  readonly proposedRegion?: ConfirmedSourceRegion;
  readonly requiresPdfEvidence?: boolean;
  readonly startByte: number;
}

export interface PrintedContentsLogicalEntry {
  readonly bodyHeadingBlockId?: string;
  readonly pageIndex?: number;
  readonly range: {
    readonly end_byte: number;
    readonly sha256: string;
    readonly start_byte: number;
  };
  readonly referenceLevel: number;
  readonly sourceTitle: string;
}

export interface PrintedContentsDetection {
  readonly canonicalRegionId?: string;
  readonly candidates: readonly PrintedContentsCandidate[];
}

export interface PrintedHeadingEvidence {
  readonly kind: "appendix" | "chapter" | "decimal" | "part";
  readonly key: string;
  readonly level: number;
}

interface ExtractedEntry {
  readonly bodyHeadingBlockId?: string;
  readonly layoutOnly?: boolean;
  readonly pageIndex?: number;
  readonly normalizedTitle: string;
  readonly numbering?: PrintedHeadingEvidence;
  readonly range: {
    readonly end_byte: number;
    readonly sha256: string;
    readonly start_byte: number;
  };
  readonly referenceLevel: number;
  readonly sourceTitle: string;
}

interface MatchCandidate {
  readonly entryIndex: number;
  readonly headingIndex: number;
  readonly score: number;
}

interface AlignmentNode extends MatchCandidate {
  readonly id: number;
  readonly total: number;
  readonly previous?: AlignmentNode;
}

const contentsTitle =
  /^(?:(?:目\s*录|简\s*(?:明\s*)?目(?:\s*录)?)(?:\s+(?:brief\s+contents|contents))?|(?:brief\s+contents|contents|table\s+of\s+contents)(?:\s+(?:目\s*录|简\s*(?:明\s*)?目(?:\s*录)?))?)$/iu;
const dotLeader = /(?:\.(?:\s*\.)+|…{1,}|·(?:\s*·)+|_(?:\s*_)+)/u;
const frontmatterEntryTitle =
  /^(?:序|序言|前言|译者序|出版者的话|作者简介|译者简介|教学建议|preface|foreword|prologue)$/iu;
const contextualEntryTitle =
  /^(?:参考文献|参考资料|索引|后记|致谢|术语表|图片来源|符号索引|思考题|本章注记|附录注记|自测题|习题|练习|课后习题和问题|复习题|人物专访|编程作业|bibliography|references|index|afterword|acknowledg(?:e)?ments?|credits|practice exercises|further reading|review questions|exercises)$/iu;
const chapterReviewParentTitle =
  /^(?:课后习题和问题|end-of-chapter questions)$/iu;
const chapterReviewChildTitle =
  /^(?:复习题|习题|练习|(?:套接字)?编程作业|家庭作业|Wireshark\s*实验(?:\s*[:：].*)?|IPsec\s*实验|人物专访|review questions|exercises|programming assignments?|homework)$/iu;
const embeddedPrintedEntryBoundary =
  /(?:\d{1,5}|[ivxlcdm]+)\s+(?=(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部)|(?:chapter|part|appendix)\b|(?:[A-Z]|\d+[A-Z])(?:\s*\.\s*\d+){1,3}\b|\d+(?:\s*\.\s*\d+){1,3}\b|practice exercises|further reading|review questions|exercises|bibliography|references|习题|练习|参考文献))/iu;
const detachedSectionNumber = /^\d+(?:\s*\.\s*\d+){1,3}\s*\.?\s*$/u;
const leadingTechnicalNumber = /^\d{2,}(?:\s*\.\s*\d+)+\s+/u;
const supplementalListTitle =
  /^(?:list\s+of\s+(?:figures|tables)|(?:图|插图|表)(?:目录|清单))$/iu;
const richTypes = new Set([
  "definition",
  "footnoteDefinition",
  "html",
  "image",
  "imageReference",
  "link",
  "linkReference",
  "math",
  "table",
]);
const maximumMatchCandidates = 200_000;
const maximumInterveningBlocks = 8;
const entrySkipCost = 2.5;
const headingSkipCost = 0.05;
const englishOrdinalWord =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
const standaloneMajorLabel = new RegExp(
  `^(?:第\\s*[0-9零〇一二三四五六七八九十百千]+\\s*(?:章|篇|部分|部)|(?:chapter|chap\\.?|part)\\s*(?:[0-9ivxlcdm]+|[A-Z]|${englishOrdinalWord}))$`,
  "iu",
);
const topLevelBackmatterTitle =
  /^(?:参考文献|参考资料|术语表|(?:译)?后记|图片来源|符号索引|索引|致谢|bibliography|references|glossary|index|afterword|acknowledg(?:e)?ments?|credits)$/iu;

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function withoutControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 8 ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127
        ? " "
        : character;
    })
    .join("");
}

function plainTitle(value: string): string {
  return withoutControlCharacters(value)
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/u, "")
    .replace(/[ \t]{2,}$/u, "")
    .trim()
    .normalize("NFKC");
}

export function inferPrintedHeadingEvidence(
  value: string,
): PrintedHeadingEvidence | undefined {
  const plain = plainTitle(value)
    .replace(/[．。]/gu, ".")
    .replace(/\s*\.\s*/gu, ".");
  const appendix =
    /^(?:附录|appendix)\s*(?<number>[A-Za-z0-9一二三四五六七八九十]+(?:\.\d+){0,3})?/iu.exec(
      plain,
    );
  if (appendix) {
    const number = appendix.groups?.number ?? "";
    return Object.freeze({
      kind: "appendix",
      key: appendix[0].replace(/\s+/gu, "").toLocaleLowerCase("und"),
      level: number.includes(".") ? Math.min(4, number.split(".").length) : 1,
    });
  }
  const named = new RegExp(
    `^(?:第\\s*([0-9零〇一二三四五六七八九十百千]+)\\s*(章|篇|部分|部)|(?:chapter|chap\\.?)\\s*([0-9ivxlcdm]+|[A-Z]|${englishOrdinalWord})(?=\\s|$|[—–:：.-])|part\\s*([0-9ivxlcdm]+|${englishOrdinalWord})(?=\\s|$|[—–:：.-]))`,
    "iu",
  ).exec(plain);
  if (named) {
    const chineseKind = named[2];
    const kind =
      chineseKind === "部分" || chineseKind === "部" || chineseKind === "篇"
        ? "part"
        : named[3]
          ? "chapter"
          : named[4]
            ? "part"
            : "chapter";
    return Object.freeze({
      kind,
      key: named[0].replace(/\s+/gu, "").toLocaleLowerCase("und"),
      level: 1,
    });
  }
  const decimal =
    /^(\d+\.\d+(?:\.\d+){0,2})(?=\s|、|:|：|[A-Za-z\u3400-\u9fff])/u.exec(
      plain,
    )?.[1];
  if (decimal) {
    return Object.freeze({
      kind: "decimal",
      key: decimal,
      level: Math.min(4, decimal.split(".").length),
    });
  }
  const alphaSection = /^(\d{1,3}[A-Z](?:\.\d+){0,2})(?=\s|、|:|：)/iu.exec(
    plain,
  )?.[1];
  if (alphaSection) {
    return Object.freeze({
      kind: "decimal",
      key: alphaSection.toLocaleLowerCase("und"),
      level: Math.min(4, 2 + (alphaSection.match(/\./gu)?.length ?? 0)),
    });
  }
  const appendixSection = /^([A-Z]\.\d+(?:\.\d+){0,2})(?=\s|、|:|：)/iu.exec(
    plain,
  )?.[1];
  if (appendixSection) {
    return Object.freeze({
      kind: "decimal",
      key: appendixSection.toLocaleLowerCase("und"),
      level: Math.min(4, appendixSection.split(".").length),
    });
  }
  const bareChapter = /^(\d{1,3})(?=\s+[\p{L}“”'"（(])/u.exec(plain)?.[1];
  if (!bareChapter) return;
  return Object.freeze({
    kind: "chapter",
    key: bareChapter,
    level: 1,
  });
}

export function inferPrintedReferenceLevel(value: string): number | undefined {
  return inferPrintedHeadingEvidence(value)?.level;
}

export function isLocalPartHeading(value: string): boolean {
  return /^第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:篇|部分|部)\s*[（(]/u.test(
    plainTitle(value),
  );
}

export function inferPrintedReferenceLevels(
  values: readonly string[],
  options: {
    readonly localPartIndexes?: ReadonlySet<number>;
    readonly referenceLevels?: ReadonlyMap<number, number>;
  } = {},
): readonly number[] {
  let insidePart = false;
  let insideAppendix = false;
  let reviewGroupLevel: number | undefined;
  let previousLevel = 0;
  const hasLaterBodyMajor: boolean[] = Array.from({ length: values.length });
  let laterBodyMajor = false;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    hasLaterBodyMajor[index] = laterBodyMajor;
    const kind = inferPrintedHeadingEvidence(values[index] ?? "")?.kind;
    const suppliedLevel = options.referenceLevels?.get(index);
    if (
      kind === "chapter" ||
      kind === "part" ||
      kind === "appendix" ||
      (suppliedLevel !== undefined && suppliedLevel <= 2)
    ) {
      laterBodyMajor = true;
    }
  }
  return Object.freeze(
    values.map((value, index) => {
      const numbering = inferPrintedHeadingEvidence(value);
      const semanticTitle =
        printedPageEvidence(value)?.title ?? plainTitle(value);
      const reviewParent = chapterReviewParentTitle.test(semanticTitle);
      const reviewChild = chapterReviewChildTitle.test(semanticTitle);
      const suppliedLevel = options.referenceLevels?.get(index);
      let level: number;
      if (suppliedLevel !== undefined) {
        level = Math.min(4, Math.max(1, suppliedLevel));
        if (numbering?.kind === "appendix" && level === 1) {
          insidePart = false;
          insideAppendix = true;
        } else if (
          numbering?.kind === "part" ||
          ((numbering?.kind === "chapter" || numbering?.kind === "decimal") &&
            level > numbering.level)
        ) {
          insidePart = true;
          insideAppendix = false;
        } else if (
          numbering?.kind === "appendix" ||
          (numbering?.kind === "chapter" && level === numbering.level)
        ) {
          insidePart = false;
          insideAppendix = false;
        }
      } else if (
        numbering?.kind === "part" &&
        options.localPartIndexes?.has(index)
      ) {
        level = 3;
      } else if (numbering?.kind === "part") {
        insidePart = true;
        insideAppendix = false;
        level = 1;
      } else if (numbering?.kind === "appendix") {
        const localUnnumberedAppendix =
          numbering.level === 1 &&
          /^(?:附录|appendix)\s*[:：]/iu.test(semanticTitle);
        if (
          numbering.level > 1 ||
          (localUnnumberedAppendix && previousLevel > 1)
        ) {
          level = Math.max(2, numbering.level);
        } else {
          insidePart = false;
          insideAppendix = true;
          level = 1;
        }
      } else if (numbering?.kind === "chapter") {
        insideAppendix = false;
        level = insidePart ? 2 : 1;
      } else if (numbering?.kind === "decimal") {
        level = Math.min(4, numbering.level + (insidePart ? 1 : 0));
      } else if (topLevelBackmatterTitle.test(semanticTitle)) {
        if (previousLevel > 1 && hasLaterBodyMajor[index]) {
          level = previousLevel;
        } else {
          insidePart = false;
          insideAppendix = false;
          level = 1;
        }
      } else if (
        /^(?:课后习题和问题|end-of-chapter questions|参考文献(?:说明)?|练习题答案|家庭作业|习题|练习|bibliographic notes|exercises|review questions)$/iu.test(
          semanticTitle,
        ) &&
        previousLevel > 0
      ) {
        level = Math.min(4, 2 + (insidePart ? 1 : 0));
      } else if (
        insideAppendix &&
        /^[A-Z]\s+[\p{L}\p{N}]/u.test(semanticTitle)
      ) {
        level = 2;
      } else {
        level = previousLevel > 0 ? previousLevel : 1;
      }
      if (reviewParent) {
        reviewGroupLevel = level;
      } else if (reviewChild && reviewGroupLevel !== undefined) {
        level = Math.min(4, reviewGroupLevel + 1);
      } else if (numbering) {
        reviewGroupLevel = undefined;
      }
      previousLevel = level;
      return level;
    }),
  );
}

function printedPageEvidence(
  value: string,
): { readonly pageLabel: string; readonly title: string } | undefined {
  const plain = plainTitle(value);
  const leader =
    /^(?<title>.+?)(?:\.(?:\s*\.)+|…{1,}|·(?:\s*·)+|_(?:\s*_)+|\s{2,})\s*(?<page>\d+|[ivxlcdm]+)\s*$/iu.exec(
      plain,
    );
  if (leader?.groups?.title && leader.groups.page) {
    return Object.freeze({
      pageLabel: leader.groups.page,
      title: leader.groups.title.trim(),
    });
  }
  const ordinary = /^(?<title>.+?)\s+(?<page>\d+|[ivxlcdm]+)\s*$/iu.exec(plain);
  const title = ordinary?.groups?.title?.trim();
  const pageLabel = ordinary?.groups?.page;
  if (
    !title ||
    !pageLabel ||
    [...title].length < 2 ||
    /^(?:chapter|chap\.?|part|section|第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部))$/iu.test(
      title,
    )
  ) {
    return;
  }
  return Object.freeze({ pageLabel, title });
}

function normalizedTitle(value: string, removePageLabel = true): string {
  const plain = plainTitle(value);
  const withoutPage = removePageLabel
    ? (printedPageEvidence(plain)?.title ?? plain)
    : plain;
  const numbering = inferPrintedHeadingEvidence(withoutPage);
  const withoutNumber = numbering
    ? withoutPage.slice(
        /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部)|(?:chapter|chap\.?)\s*(?:[0-9ivxlcdm]+|[A-Z]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)|part\s*(?:[0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)|附录\s*[A-Za-z0-9一二三四五六七八九十]*(?:\.\d+){0,3}|[A-Z]\.\d+(?:\.\d+){0,2}|\d+[A-Z](?:\.\d+){0,2}|\d+(?:\.\d+){0,3})/iu.exec(
          withoutPage,
        )?.[0].length ?? 0,
      )
    : withoutPage;
  const comparisonTitle = withoutNumber.trim() ? withoutNumber : withoutPage;
  return comparisonTitle
    .replace(/^[\s、:：.\-—]+/u, "")
    .replace(/[，,。.;；:：!?！？'"“”‘’()（）[\]【】\-—_]/gu, "")
    .replace(/\s+/gu, "")
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("und");
}

function containsRichContent(node: TransientDocumentNode): boolean {
  if (richTypes.has(node.type)) return true;
  return (node.children ?? []).some(containsRichContent);
}

function rootTitle(node: TransientDocumentNode): string {
  const values: string[] = [];
  const visit = (current: TransientDocumentNode) => {
    if (current.type === "text" && current.value) values.push(current.value);
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return values.join("").trim();
}

function contextualLevel(
  title: string,
  numbering: PrintedHeadingEvidence | undefined,
  previousLevel: number,
): number {
  if (numbering) return numbering.level;
  if (
    /^(?:参考文献(?:说明)?|练习题答案|家庭作业|习题|练习|bibliographic notes|exercises|review questions)$/iu.test(
      plainTitle(title),
    ) &&
    previousLevel > 0
  ) {
    return 2;
  }
  return previousLevel > 0 ? Math.min(2, previousLevel) : 1;
}

function splitPrintedLogicalLine(value: string): readonly {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}[] {
  const boundary = new RegExp(embeddedPrintedEntryBoundary.source, "giu");
  const segments: { end: number; start: number; text: string }[] = [];
  let cursor = 0;
  for (const match of value.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end <= cursor || end >= value.length) continue;
    segments.push({ end, start: cursor, text: value.slice(cursor, end) });
    cursor = end;
  }
  segments.push({
    end: value.length,
    start: cursor,
    text: value.slice(cursor),
  });
  return Object.freeze(segments.filter((segment) => segment.text.trim()));
}

function lineEntries(input: {
  readonly block: TransientDocumentNode;
  readonly previousLevel: number;
  readonly source: string;
  readonly sourceBytes: Uint8Array;
}): readonly ExtractedEntry[] {
  if (!input.block.position) return [];
  const blockSource = input.source.slice(
    input.block.position.start.offset,
    input.block.position.end.offset,
  );
  const entries: ExtractedEntry[] = [];
  let lineOffset = 0;
  let previousLevel = input.previousLevel;
  for (const line of blockSource.split(/\n/u)) {
    for (const segment of splitPrintedLogicalLine(line)) {
      const plain = plainTitle(segment.text);
      const numbering = inferPrintedHeadingEvidence(plain);
      const hasPrintedPage = printedPageEvidence(plain) !== undefined;
      if (
        hasPrintedPage ||
        numbering ||
        detachedSectionNumber.test(plain) ||
        frontmatterEntryTitle.test(plain) ||
        contextualEntryTitle.test(plain)
      ) {
        const title = normalizedTitle(segment.text);
        if (title) {
          const startOffset =
            input.block.position.start.offset + lineOffset + segment.start;
          const endOffset =
            input.block.position.start.offset + lineOffset + segment.end;
          const startByte = utf8ByteOffset(input.source, startOffset);
          const endByte = utf8ByteOffset(input.source, endOffset);
          const referenceLevel = contextualLevel(
            segment.text,
            numbering,
            previousLevel,
          );
          previousLevel = referenceLevel;
          entries.push(
            Object.freeze({
              normalizedTitle: title,
              ...(numbering ? { numbering } : {}),
              range: Object.freeze({
                end_byte: endByte,
                sha256: hash(input.sourceBytes.subarray(startByte, endByte)),
                start_byte: startByte,
              }),
              referenceLevel,
              sourceTitle: segment.text,
            }),
          );
        }
      }
    }
    lineOffset += line.length + 1;
  }
  return Object.freeze(entries);
}

function mergeDetachedSourceEntries(
  entries: readonly ExtractedEntry[],
  sourceBytes: Uint8Array,
): readonly ExtractedEntry[] {
  const merged: ExtractedEntry[] = [];
  const truncatedReview = new RegExp(
    `^复\\s*(?<suffix>${dotLeader.source}\\s*(?:\\d+|[ivxlcdm]+)\\s*)$`,
    "iu",
  );
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    const next = entries[index + 1];
    if (!current) continue;
    const detached = /^(?<number>\d+(?:\s*\.\s*\d+){1,3})\s*\.?\s*$/u.exec(
      plainTitle(current.sourceTitle),
    );
    if (
      detached?.groups?.number &&
      next &&
      leadingTechnicalNumber.test(plainTitle(next.sourceTitle)) &&
      printedPageEvidence(next.sourceTitle) !== undefined
    ) {
      const sourceTitle = `${detached.groups.number} ${plainTitle(next.sourceTitle)}`;
      const numbering = inferPrintedHeadingEvidence(sourceTitle);
      merged.push(
        Object.freeze({
          ...current,
          ...(numbering ? { numbering } : {}),
          normalizedTitle: normalizedTitle(sourceTitle),
          range: Object.freeze({
            end_byte: next.range.end_byte,
            sha256: hash(
              sourceBytes.subarray(
                current.range.start_byte,
                next.range.end_byte,
              ),
            ),
            start_byte: current.range.start_byte,
          }),
          sourceTitle,
        }),
      );
      index += 1;
      continue;
    }
    const review = truncatedReview.exec(plainTitle(current.sourceTitle));
    if (review?.groups?.suffix) {
      const previous = merged.at(-1);
      const previousTitle = previous
        ? (printedPageEvidence(previous.sourceTitle)?.title ??
          plainTitle(previous.sourceTitle))
        : "";
      const hasParent = chapterReviewParentTitle.test(previousTitle);
      const titles = hasParent
        ? [`复习题 ${review.groups.suffix}`]
        : [
            `课后习题和问题 ${review.groups.suffix}`,
            `复习题 ${review.groups.suffix}`,
          ];
      merged.push(
        ...titles.map((sourceTitle, reviewIndex) =>
          Object.freeze({
            ...current,
            normalizedTitle: normalizedTitle(sourceTitle),
            referenceLevel: Math.min(
              4,
              hasParent
                ? (previous?.referenceLevel ?? current.referenceLevel) + 1
                : current.referenceLevel + reviewIndex,
            ),
            sourceTitle,
          }),
        ),
      );
      continue;
    }
    if (detached) continue;
    merged.push(current);
  }
  return Object.freeze(merged);
}

function hasPrintedPageLine(
  block: TransientDocumentNode | undefined,
  source: string,
): boolean {
  if (!block?.position) return false;
  return source
    .slice(block.position.start.offset, block.position.end.offset)
    .split(/\n/u)
    .some((line) => printedPageEvidence(line) !== undefined);
}

function requiresPdfLineRepair(
  block: TransientDocumentNode,
  source: string,
): boolean {
  if (!block.position) return false;
  return source
    .slice(block.position.start.offset, block.position.end.offset)
    .split(/\n/u)
    .some((line) => {
      const plain = plainTitle(line);
      if (embeddedPrintedEntryBoundary.test(plain)) return true;
      if (
        inferPrintedHeadingEvidence(plain) !== undefined &&
        printedPageEvidence(plain) === undefined &&
        !standaloneMajorLabel.test(plain)
      ) {
        return true;
      }
      if (new RegExp(`${dotLeader.source}\\s*$`, "iu").test(plain)) {
        return true;
      }
      const pageLike = new RegExp(
        `${dotLeader.source}\\s*(?:\\d+|[ivxlcdm]+)\\s*$`,
        "iu",
      ).test(plain);
      if (!pageLike) return false;
      const evidence = printedPageEvidence(plain);
      return !evidence || /^[.…·_\s]+$/u.test(evidence.title);
    });
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right || Math.min(left.length, right.length) < 3) return 0;
  const bigrams = (value: string): Map<string, number> => {
    const output = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const key = value.slice(index, index + 2);
      output.set(key, (output.get(key) ?? 0) + 1);
    }
    return output;
  };
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  let overlap = 0;
  for (const [key, count] of leftPairs) {
    overlap += Math.min(count, rightPairs.get(key) ?? 0);
  }
  return (2 * overlap) / (left.length + right.length - 2);
}

function matchScore(
  entry: ExtractedEntry,
  heading: NormalizedHeading,
  allowNumberOnly = false,
): number {
  const headingTitle = normalizedTitle(heading.sourceTitle, false);
  const headingNumber = inferPrintedHeadingEvidence(heading.sourceTitle);
  const titleScore = similarity(entry.normalizedTitle, headingTitle);
  const numberEqual =
    entry.numbering &&
    headingNumber &&
    entry.numbering.key === headingNumber.key;
  const numberConflict =
    entry.numbering &&
    headingNumber &&
    entry.numbering.key !== headingNumber.key;
  const detachedMajorTitle =
    (entry.numbering?.kind === "part" || entry.numbering?.kind === "chapter") &&
    headingNumber === undefined &&
    titleScore >= 0.7;
  if (
    numberConflict ||
    (!numberEqual && titleScore < 0.62) ||
    (numberEqual && !allowNumberOnly && titleScore < 0.2)
  ) {
    return 0;
  }
  return (
    Math.round(titleScore * 10) +
    (numberEqual ? 8 : 0) +
    (detachedMajorTitle ? 20 : 0)
  );
}

function recoveredMatchedSourceTitle(
  entry: ExtractedEntry,
  heading: NormalizedHeading,
): string {
  const sourceTitle = plainTitle(entry.sourceTitle);
  const headingNumber = inferPrintedHeadingEvidence(heading.sourceTitle);
  const headingTitle = normalizedTitle(heading.sourceTitle, false);
  if (
    (entry.numbering?.kind === "part" || entry.numbering?.kind === "chapter") &&
    headingNumber === undefined
  ) {
    return sourceTitle;
  }
  if (similarity(entry.normalizedTitle, headingTitle) >= 0.9) {
    return sourceTitle;
  }
  if (entry.normalizedTitle.length > 12) return sourceTitle;
  const printed = printedPageEvidence(sourceTitle);
  const bodyTitle = plainTitle(heading.sourceTitle);
  if (!printed) return bodyTitle;
  const suffix =
    /(?<suffix>(?:\.(?:\s*\.)+|…+|·(?:\s*·)+|_(?:\s*_)+|\s+)\s*(?:[ivxlcdm]+|\d{1,5})\s*)$/iu.exec(
      sourceTitle,
    )?.groups?.suffix;
  return `${bodyTitle}${suffix ?? `  ${printed.pageLabel}`}`;
}

function monotonicMatches(
  entries: readonly ExtractedEntry[],
  headings: readonly NormalizedHeading[],
  options: { readonly allowNumberOnly?: boolean } = {},
): {
  readonly bestScore: number;
  readonly ambiguousEntries: ReadonlySet<number>;
  readonly margin: number;
  readonly matches: ReadonlyMap<number, number>;
  readonly secondBestScore: number;
} {
  const candidates: MatchCandidate[] = [];
  const exactHeadings = new Map<string, number[]>();
  const numberedHeadings = new Map<string, number[]>();
  for (const [index, heading] of headings.entries()) {
    const title = normalizedTitle(heading.sourceTitle, false);
    exactHeadings.set(title, [...(exactHeadings.get(title) ?? []), index]);
    const number = inferPrintedHeadingEvidence(heading.sourceTitle);
    if (number) {
      numberedHeadings.set(number.key, [
        ...(numberedHeadings.get(number.key) ?? []),
        index,
      ]);
    }
  }
  for (const [entryIndex, entry] of entries.entries()) {
    const indexes = new Set(exactHeadings.get(entry.normalizedTitle) ?? []);
    if (entry.numbering) {
      for (const index of numberedHeadings.get(entry.numbering.key) ?? []) {
        indexes.add(index);
      }
    }
    if (indexes.size === 0) {
      for (const [headingIndex, heading] of headings.entries()) {
        const headingTitle = normalizedTitle(heading.sourceTitle, false);
        if (
          headingTitle.slice(0, 4) === entry.normalizedTitle.slice(0, 4) ||
          similarity(entry.normalizedTitle, headingTitle) >= 0.62
        ) {
          indexes.add(headingIndex);
        }
        if (indexes.size >= 50) break;
      }
    }
    for (const headingIndex of indexes) {
      const heading = headings[headingIndex];
      if (!heading) continue;
      const score = matchScore(entry, heading, options.allowNumberOnly);
      if (score > 0) candidates.push({ entryIndex, headingIndex, score });
      if (candidates.length >= maximumMatchCandidates) break;
    }
    if (candidates.length >= maximumMatchCandidates) break;
  }
  candidates.sort(
    (left, right) =>
      left.entryIndex - right.entryIndex ||
      left.headingIndex - right.headingIndex ||
      right.score - left.score,
  );
  interface RankedNode {
    readonly rank: number;
    readonly state: AlignmentNode;
  }
  const topTwo = (values: readonly RankedNode[]): readonly RankedNode[] => {
    const byState = new Map<number, RankedNode>();
    for (const value of values) {
      const current = byState.get(value.state.id);
      if (!current || value.rank > current.rank)
        byState.set(value.state.id, value);
    }
    return Object.freeze(
      [...byState.values()]
        .sort(
          (left, right) =>
            right.rank - left.rank || left.state.id - right.state.id,
        )
        .slice(0, 2),
    );
  };
  const tree: (readonly RankedNode[] | undefined)[] = Array.from({
    length: headings.length + 1,
  });
  const query = (exclusiveHeadingIndex: number): readonly RankedNode[] => {
    let cursor = exclusiveHeadingIndex;
    const found: RankedNode[] = [];
    while (cursor > 0) {
      found.push(...(tree[cursor] ?? []));
      cursor -= cursor & -cursor;
    }
    return topTwo(found);
  };
  const update = (headingIndex: number, value: AlignmentNode) => {
    let cursor = headingIndex + 1;
    const ranked = Object.freeze({
      rank:
        value.total +
        entrySkipCost * value.entryIndex +
        headingSkipCost * value.headingIndex,
      state: value,
    });
    while (cursor < tree.length) {
      tree[cursor] = topTwo([...(tree[cursor] ?? []), ranked]);
      cursor += cursor & -cursor;
    }
  };
  let nextId = 1;
  let cursor = 0;
  const allStates: AlignmentNode[] = [];
  while (cursor < candidates.length) {
    const entryIndex = candidates[cursor]?.entryIndex;
    const pending: AlignmentNode[] = [];
    while (
      cursor < candidates.length &&
      candidates[cursor]?.entryIndex === entryIndex
    ) {
      const candidate = candidates[cursor];
      if (!candidate) break;
      const possible: AlignmentNode[] = [
        {
          ...candidate,
          id: nextId++,
          total: candidate.score - entrySkipCost * candidate.entryIndex,
        },
      ];
      for (const previous of query(candidate.headingIndex)) {
        possible.push({
          ...candidate,
          id: nextId++,
          previous: previous.state,
          total:
            previous.state.total +
            candidate.score -
            entrySkipCost *
              Math.max(
                0,
                candidate.entryIndex - previous.state.entryIndex - 1,
              ) -
            headingSkipCost *
              Math.min(
                20,
                Math.max(
                  0,
                  candidate.headingIndex - previous.state.headingIndex - 1,
                ),
              ),
        });
      }
      pending.push(
        ...topTwo(possible.map((state) => ({ rank: state.total, state }))).map(
          (item) => item.state,
        ),
      );
      cursor += 1;
    }
    for (const node of pending) {
      update(node.headingIndex, node);
      allStates.push(node);
    }
  }

  const completed = topTwo(
    allStates.map((state) => ({
      rank:
        state.total -
        entrySkipCost * Math.max(0, entries.length - state.entryIndex - 1),
      state,
    })),
  );
  const best = completed[0];
  const second = completed[1];
  const path = (
    last: AlignmentNode | undefined,
  ): ReadonlyMap<number, number> => {
    const output = new Map<number, number>();
    for (let node = last; node; node = node.previous) {
      output.set(node.entryIndex, node.headingIndex);
    }
    return output;
  };
  const matches = new Map(path(best?.state));
  const alternative = path(second?.state);
  const bestScore = best?.rank ?? -entrySkipCost * entries.length;
  const secondBestScore = second?.rank ?? bestScore - 1_000;
  const margin = Math.max(0, bestScore - secondBestScore);
  const ambiguousEntries = new Set<number>();
  if (margin < 2) {
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      if (matches.get(entryIndex) !== alternative.get(entryIndex)) {
        ambiguousEntries.add(entryIndex);
        matches.delete(entryIndex);
      }
    }
  }
  return Object.freeze({
    ambiguousEntries: Object.freeze(ambiguousEntries),
    bestScore,
    margin,
    matches: Object.freeze(matches),
    secondBestScore,
  });
}

function diagnostic(
  code: PrintedContentsDiagnostic["code"],
  path: string,
  blockId?: string,
): PrintedContentsDiagnostic {
  return Object.freeze({
    ...(blockId ? { blockId } : {}),
    code,
    path: path.slice(0, 500),
  });
}

function layoutLevels(
  evidence: LayoutEvidence | undefined,
): ReadonlyMap<string, readonly number[]> {
  if (!evidence || evidence.records.length === 0) return new Map();
  const rows = reconstructPrintedLayoutRows(evidence).filter(
    (record) =>
      inferPrintedHeadingEvidence(record.text) ||
      printedPageEvidence(record.text),
  );
  const inferredLevels = inferPrintedReferenceLevels(
    rows.map((record) => record.text),
  );
  const explicit = rows.flatMap((record, index) => {
    const number = inferPrintedHeadingEvidence(record.text);
    const level = inferredLevels[index];
    return number && level ? [{ indent: record.indent, level }] : [];
  });
  const medians = new Map<number, number>();
  for (const level of [1, 2, 3, 4]) {
    const values = explicit
      .filter((item) => item.level === level)
      .map((item) => item.indent)
      .sort((left, right) => left - right);
    const value = values[Math.floor(values.length / 2)];
    if (value !== undefined) medians.set(level, value);
  }
  const output = new Map<string, number[]>();
  for (const [index, row] of rows.entries()) {
    const numbering = inferPrintedHeadingEvidence(row.text);
    let level = numbering ? inferredLevels[index] : undefined;
    if (!level && medians.size > 0) {
      level = [...medians].sort(
        (left, right) =>
          Math.abs(left[1] - row.indent) - Math.abs(right[1] - row.indent),
      )[0]?.[0];
    }
    level ??= inferredLevels[index];
    if (level) {
      const key = normalizedTitle(row.text);
      output.set(key, [...(output.get(key) ?? []), level]);
    }
  }
  return output;
}

function layoutLogicalEntries(
  evidence: LayoutEvidence | undefined,
): readonly Omit<ExtractedEntry, "range">[] {
  if (
    !evidence ||
    (evidence.source !== "native-pdf" &&
      evidence.source !== "ocr" &&
      !evidence.records.some((record) => record.pageLabelSupplemented))
  ) {
    return Object.freeze([]);
  }
  const rows = reconstructPrintedLayoutRows(evidence);
  const pageStats = new Map<
    number,
    { readonly labelled: boolean; readonly printedRows: number }
  >();
  for (const row of rows) {
    const current = pageStats.get(row.pageIndex) ?? {
      labelled: false,
      printedRows: 0,
    };
    pageStats.set(row.pageIndex, {
      labelled:
        current.labelled ||
        contentsTitle.test(row.text.trim().normalize("NFKC")),
      printedRows:
        current.printedRows + (printedPageEvidence(row.text) ? 1 : 0),
    });
  }
  const candidatePages = new Set(
    [...pageStats].flatMap(([pageIndex, stats]) =>
      stats.labelled || stats.printedRows >= 2 ? [pageIndex] : [],
    ),
  );
  const selected = rows.filter(
    (row) =>
      candidatePages.has(row.pageIndex) &&
      !contentsTitle.test(row.text.trim().normalize("NFKC")) &&
      printedPageEvidence(row.text) !== undefined,
  );
  if (selected.length < 3) return Object.freeze([]);
  const levelsByTitle = layoutLevels(evidence);
  const occurrences = new Map<string, number>();
  const levels = inferPrintedReferenceLevels(
    selected.map((row) => row.text),
    {
      referenceLevels: new Map(
        selected.flatMap((row, index) => {
          const title = normalizedTitle(row.text);
          const occurrence = occurrences.get(title) ?? 0;
          occurrences.set(title, occurrence + 1);
          if (!inferPrintedHeadingEvidence(row.text)) return [];
          const levels = levelsByTitle.get(title);
          const level = levels?.[occurrence] ?? levels?.at(-1);
          return level === undefined ? [] : [[index, level] as const];
        }),
      ),
    },
  );
  return Object.freeze(
    selected.flatMap((row, index) => {
      const normalized = normalizedTitle(row.text);
      if (!normalized) return [];
      const numbering = inferPrintedHeadingEvidence(row.text);
      return [
        Object.freeze({
          normalizedTitle: normalized,
          ...(numbering ? { numbering } : {}),
          pageIndex: row.pageIndex,
          referenceLevel:
            levels[index] ?? contextualLevel(row.text, numbering, 0),
          sourceTitle: row.text,
        }),
      ];
    }),
  );
}

function recoverLayoutLogicalEntries(
  sourceEntries: readonly ExtractedEntry[],
  evidence: LayoutEvidence | undefined,
): readonly ExtractedEntry[] {
  const layoutEntries = layoutLogicalEntries(evidence);
  if (sourceEntries.length < 2 || layoutEntries.length < 3)
    return sourceEntries;
  const layoutHeadings: readonly NormalizedHeading[] = layoutEntries.map(
    (entry, index) =>
      Object.freeze({
        blockId: `layout-${index}`,
        level: entry.referenceLevel,
        sourceTitle: entry.sourceTitle,
        textFingerprint: "",
      }),
  );
  const alignment = monotonicMatches(sourceEntries, layoutHeadings, {
    allowNumberOnly: true,
  });
  const anchors = [...alignment.matches]
    .map(([sourceIndex, layoutIndex]) => ({ layoutIndex, sourceIndex }))
    .sort(
      (left, right) =>
        left.layoutIndex - right.layoutIndex ||
        left.sourceIndex - right.sourceIndex,
    );
  const first = anchors[0];
  const last = anchors.at(-1);
  if (!first || !last || anchors.length < 3) return sourceEntries;
  const sourceSpan = last.sourceIndex - first.sourceIndex + 1;
  const layoutSpan = last.layoutIndex - first.layoutIndex + 1;
  const anchorCoverage =
    anchors.length / Math.max(1, Math.min(sourceSpan, layoutSpan));
  if (
    sourceSpan < 2 ||
    layoutSpan < 2 ||
    layoutSpan > sourceSpan * 2 + 20 ||
    anchorCoverage < 0.35
  ) {
    return sourceEntries;
  }
  const sourceByLayout = new Map(
    anchors.map((anchor) => [anchor.layoutIndex, anchor.sourceIndex] as const),
  );
  const nearestSourceIndex = (layoutIndex: number): number => {
    const exact = sourceByLayout.get(layoutIndex);
    if (exact !== undefined) return exact;
    let selected = first.sourceIndex;
    let distance = Number.POSITIVE_INFINITY;
    for (const anchor of anchors) {
      const candidate = Math.abs(anchor.layoutIndex - layoutIndex);
      if (candidate < distance) {
        selected = anchor.sourceIndex;
        distance = candidate;
      }
    }
    return selected;
  };
  const recovered: ExtractedEntry[] = [];
  let sourceCursor = 0;
  let layoutCursor = 0;
  for (const anchor of anchors) {
    const sourceGap = sourceEntries.slice(sourceCursor, anchor.sourceIndex);
    const layoutGap = layoutEntries.slice(layoutCursor, anchor.layoutIndex);
    const damagedSourceGap = sourceGap.some(
      (entry) =>
        entry.normalizedTitle.length < 3 ||
        (entry.normalizedTitle.length <= 4 &&
          dotLeader.test(entry.sourceTitle)),
    );
    const fillsEmptyGap = sourceGap.length === 0 && layoutGap.length <= 2;
    const replacesDamagedGap =
      damagedSourceGap &&
      sourceGap.length <= 2 &&
      layoutGap.length >= sourceGap.length &&
      layoutGap.length <= sourceGap.length + 8;
    if (layoutGap.length > 0 && (fillsEmptyGap || replacesDamagedGap)) {
      recovered.push(
        ...layoutGap.map((entry, offset) => {
          const sourceEntry =
            sourceEntries[nearestSourceIndex(layoutCursor + offset)];
          if (!sourceEntry) {
            throw new Error("PRINTED_TOC_LAYOUT_PROVENANCE_MISSING");
          }
          return Object.freeze({
            ...entry,
            ...(fillsEmptyGap ? { layoutOnly: true } : {}),
            range: sourceEntry.range,
          });
        }),
      );
    } else {
      recovered.push(...sourceGap);
    }
    const sourceEntry = sourceEntries[anchor.sourceIndex];
    const layoutEntry = layoutEntries[anchor.layoutIndex];
    if (!sourceEntry || !layoutEntry) {
      throw new Error("PRINTED_TOC_LAYOUT_PROVENANCE_MISSING");
    }
    const sourceAnchorDamaged = sourceEntry.normalizedTitle.length < 3;
    const sourcePrinted = printedPageEvidence(sourceEntry.sourceTitle);
    const layoutPrinted = printedPageEvidence(layoutEntry.sourceTitle);
    const layoutHasMissingPage =
      sourcePrinted === undefined &&
      layoutPrinted !== undefined &&
      (new RegExp(`${dotLeader.source}\\s*$`, "iu").test(
        plainTitle(sourceEntry.sourceTitle),
      ) ||
        similarity(
          sourceEntry.normalizedTitle,
          normalizedTitle(layoutPrinted.title),
        ) >= 0.9);
    recovered.push(
      sourceAnchorDamaged || layoutHasMissingPage
        ? Object.freeze({
            ...layoutEntry,
            range: sourceEntry.range,
            sourceTitle:
              layoutHasMissingPage && layoutPrinted
                ? `${plainTitle(sourceEntry.sourceTitle)}  ${layoutPrinted.pageLabel}`
                : layoutEntry.sourceTitle,
          })
        : Object.freeze({
            ...sourceEntry,
            ...(layoutEntry.pageIndex === undefined
              ? {}
              : { pageIndex: layoutEntry.pageIndex }),
            sourceTitle: plainTitle(sourceEntry.sourceTitle),
          }),
    );
    sourceCursor = anchor.sourceIndex + 1;
    layoutCursor = anchor.layoutIndex + 1;
  }
  recovered.push(...sourceEntries.slice(sourceCursor));
  return Object.freeze(recovered);
}

export function detectPrintedContents(input: {
  readonly document: NormalizedDocument;
  readonly idFactory?: () => string;
  readonly layoutEvidence?: LayoutEvidence;
  readonly sourcePath: string;
  readonly sourceSha256: string;
}): PrintedContentsDetection {
  const sourceBytes = Buffer.from(input.document.source, "utf8");
  if (hash(sourceBytes) !== input.sourceSha256) {
    throw new Error("PRINTED_TOC_SOURCE_HASH_MISMATCH");
  }
  const roots = input.document.root.children ?? [];
  const layoutLevelByTitle = layoutLevels(input.layoutEvidence);
  const layoutOccurrences = new Map<string, number>();
  const ranges: {
    readonly endIndex: number;
    readonly explicit: boolean;
    readonly firstEntryIndex: number;
    readonly startIndex: number;
  }[] = [];
  const explicitLabels = roots.flatMap((root, index) =>
    contentsTitle.test(rootTitle(root).normalize("NFKC")) ? [index] : [],
  );
  for (let labelIndex = 0; labelIndex < explicitLabels.length;) {
    const startIndex = explicitLabels[labelIndex];
    if (startIndex === undefined) break;
    let labelEndIndex = startIndex;
    while (explicitLabels[labelIndex + 1] === labelEndIndex + 1) {
      labelEndIndex = explicitLabels[++labelIndex] ?? labelEndIndex;
    }
    ranges.push({
      endIndex: (explicitLabels[labelIndex + 1] ?? roots.length) - 1,
      explicit: true,
      firstEntryIndex: labelEndIndex + 1,
      startIndex,
    });
    labelIndex += 1;
  }
  if (ranges.length === 0) {
    const searchLimit = roots.length;
    for (let index = 0; index < searchLimit; index += 1) {
      if (index / Math.max(1, roots.length) > 0.5) break;
      const root = roots[index];
      if (!root?.position) continue;
      const seed = lineEntries({
        block: root,
        previousLevel: 0,
        source: input.document.source,
        sourceBytes,
      });
      if (seed.length === 0) continue;
      let evidenceEntries = seed.length;
      let noiseBlocks = 0;
      for (
        let cursor = index + 1;
        cursor < Math.min(searchLimit, index + 24);
        cursor += 1
      ) {
        const candidate = roots[cursor];
        if (!candidate?.position) continue;
        const extracted = lineEntries({
          block: candidate,
          previousLevel: 0,
          source: input.document.source,
          sourceBytes,
        });
        if (extracted.length > 0) {
          evidenceEntries += extracted.length;
          noiseBlocks = 0;
        } else if (
          evidenceEntries > 0 &&
          ++noiseBlocks > maximumInterveningBlocks
        ) {
          break;
        }
      }
      if (evidenceEntries >= 3) {
        ranges.push({
          endIndex: roots.length - 1,
          explicit: false,
          firstEntryIndex: index,
          startIndex: index,
        });
        break;
      }
    }
  }

  const candidates: PrintedContentsCandidate[] = [];
  for (const range of ranges) {
    const sourceEntries: ExtractedEntry[] = [];
    let candidateEndIndex = range.startIndex;
    let richContent = false;
    let noiseBlocks = 0;
    let requiresPdfEvidence = false;
    for (
      let index = range.firstEntryIndex;
      index <= range.endIndex;
      index += 1
    ) {
      const block = roots[index];
      if (!block?.position) continue;
      if (
        sourceEntries.length > 0 &&
        supplementalListTitle.test(rootTitle(block).normalize("NFKC"))
      ) {
        break;
      }
      const possibleBodyTitle =
        block.type === "heading" ? normalizedTitle(rootTitle(block)) : "";
      const printedRowsContinue = roots
        .slice(index + 1, index + 5)
        .some((candidate) =>
          hasPrintedPageLine(candidate, input.document.source),
        );
      const nextBlock = roots[index + 1];
      const nextBodyTitle =
        nextBlock?.type === "heading"
          ? normalizedTitle(rootTitle(nextBlock))
          : "";
      const currentKind = inferPrintedHeadingEvidence(rootTitle(block))?.kind;
      if (
        sourceEntries.length > 0 &&
        !printedRowsContinue &&
        block.type === "heading" &&
        (currentKind === "part" || currentKind === "chapter") &&
        printedPageEvidence(rootTitle(block)) === undefined &&
        standaloneMajorLabel.test(plainTitle(rootTitle(block))) &&
        nextBodyTitle &&
        sourceEntries.some((entry) => entry.normalizedTitle === nextBodyTitle)
      ) {
        break;
      }
      if (
        sourceEntries.length > 0 &&
        possibleBodyTitle &&
        sourceEntries.some(
          (entry) => entry.normalizedTitle === possibleBodyTitle,
        ) &&
        printedPageEvidence(rootTitle(block)) === undefined &&
        !printedRowsContinue
      ) {
        break;
      }
      const extracted = lineEntries({
        block,
        previousLevel: sourceEntries.at(-1)?.referenceLevel ?? 0,
        source: input.document.source,
        sourceBytes,
      });
      if (requiresPdfLineRepair(block, input.document.source)) {
        requiresPdfEvidence = true;
      }
      if (containsRichContent(block)) richContent = true;
      if (extracted.length > 0) {
        sourceEntries.push(...extracted);
        candidateEndIndex = index;
        noiseBlocks = 0;
      } else if (sourceEntries.length > 0) {
        noiseBlocks += 1;
        if (noiseBlocks > maximumInterveningBlocks) break;
      }
      if (sourceEntries.length > 20_000) break;
    }
    const entries = [
      ...recoverLayoutLogicalEntries(
        mergeDetachedSourceEntries(sourceEntries, sourceBytes),
        input.layoutEvidence,
      ),
    ];
    const inferredLevels = inferPrintedReferenceLevels(
      entries.map((entry) => entry.sourceTitle),
    );
    let previousResolvedLevel = 0;
    entries.forEach((entry, index) => {
      const occurrence = layoutOccurrences.get(entry.normalizedTitle) ?? 0;
      layoutOccurrences.set(entry.normalizedTitle, occurrence + 1);
      const layoutLevelsForTitle = layoutLevelByTitle.get(
        entry.normalizedTitle,
      );
      const layoutLevel =
        layoutLevelsForTitle?.[occurrence] ?? layoutLevelsForTitle?.at(-1);
      const semanticTitle =
        printedPageEvidence(entry.sourceTitle)?.title ??
        plainTitle(entry.sourceTitle);
      const proposedLevel =
        entry.numbering ||
        chapterReviewChildTitle.test(semanticTitle) ||
        contextualEntryTitle.test(semanticTitle)
          ? (inferredLevels[index] ?? entry.referenceLevel)
          : topLevelBackmatterTitle.test(semanticTitle)
            ? (inferredLevels[index] ?? entry.referenceLevel)
            : Math.max(
                inferredLevels[index] ?? entry.referenceLevel,
                layoutLevel ?? 0,
              );
      const referenceLevel = Math.min(
        proposedLevel,
        previousResolvedLevel === 0 ? 1 : previousResolvedLevel + 1,
      );
      entries[index] = Object.freeze({ ...entry, referenceLevel });
      previousResolvedLevel = referenceLevel;
    });

    const candidateEndOffset =
      roots[candidateEndIndex]?.position?.end.offset ??
      Number.POSITIVE_INFINITY;
    const candidateStartOffset =
      roots[range.startIndex]?.position?.start.offset ??
      Number.NEGATIVE_INFINITY;
    const eligibleHeading = (
      heading: NormalizedHeading,
      allowNumberedPageSuffix = false,
    ): boolean =>
      !contentsTitle.test(heading.sourceTitle.normalize("NFKC")) &&
      (allowNumberedPageSuffix ||
        printedPageEvidence(heading.sourceTitle) === undefined);
    const laterHeadings = input.document.headings.filter(
      (heading) =>
        (heading.position?.start.offset ?? Number.NEGATIVE_INFINITY) >
          candidateEndOffset && eligibleHeading(heading, true),
    );
    const bodyHeadings = input.document.headings.filter((heading) => {
      const start = heading.position?.start.offset ?? Number.NEGATIVE_INFINITY;
      return (
        (start < candidateStartOffset || start > candidateEndOffset) &&
        eligibleHeading(heading, start > candidateEndOffset)
      );
    });
    const alignment = monotonicMatches(entries, bodyHeadings, {
      allowNumberOnly: true,
    });
    const resolvedMatches = new Map(alignment.matches);
    const usedHeadingIndexes = new Set(resolvedMatches.values());
    for (const [entryIndex, entry] of entries.entries()) {
      if (
        resolvedMatches.has(entryIndex) ||
        (entry.numbering?.kind !== "part" &&
          entry.numbering?.kind !== "chapter")
      ) {
        continue;
      }
      let lowerBound = -1;
      let upperBound = bodyHeadings.length;
      for (const [matchedEntryIndex, headingIndex] of resolvedMatches) {
        if (matchedEntryIndex < entryIndex && headingIndex > lowerBound) {
          lowerBound = headingIndex;
        } else if (
          matchedEntryIndex > entryIndex &&
          headingIndex < upperBound
        ) {
          upperBound = headingIndex;
        }
      }
      const candidates = bodyHeadings
        .map((heading, headingIndex) => ({
          headingIndex,
          score:
            headingIndex > lowerBound &&
            headingIndex < upperBound &&
            !usedHeadingIndexes.has(headingIndex)
              ? matchScore(entry, heading, true)
              : 0,
        }))
        .filter((candidate) => candidate.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score || left.headingIndex - right.headingIndex,
        );
      const best = candidates[0];
      const second = candidates[1];
      if (best && best.score >= 16 && best.score - (second?.score ?? 0) >= 4) {
        resolvedMatches.set(entryIndex, best.headingIndex);
        usedHeadingIndexes.add(best.headingIndex);
      }
    }
    const diagnostics: PrintedContentsDiagnostic[] = [];
    const matchedEntries = entries.flatMap((entry, entryIndex) => {
      if (alignment.ambiguousEntries.has(entryIndex)) {
        if (entry.layoutOnly) return [];
        diagnostics.push(
          diagnostic(
            "PRINTED_TOC_AMBIGUOUS_MATCH",
            `candidates/${candidates.length}/entries/${entryIndex}`,
          ),
        );
        return [entry];
      }
      const headingIndex = resolvedMatches.get(entryIndex);
      const match =
        headingIndex === undefined ? undefined : bodyHeadings[headingIndex];
      if (!match) {
        if (entry.layoutOnly) return [];
        diagnostics.push(
          diagnostic(
            "PRINTED_TOC_UNMATCHED_ENTRY",
            `candidates/${candidates.length}/entries/${entryIndex}`,
          ),
        );
        return [entry];
      }
      const sourceTitle = recoveredMatchedSourceTitle(entry, match);
      return [
        Object.freeze({
          ...entry,
          bodyHeadingBlockId: match.blockId,
          normalizedTitle: normalizedTitle(sourceTitle),
          sourceTitle,
        }),
      ];
    });
    const nearestMatchedBlock = (entryIndex: number): string | undefined => {
      for (let distance = 1; distance < matchedEntries.length; distance += 1) {
        const before = matchedEntries[entryIndex - distance];
        if (before?.bodyHeadingBlockId) return before.bodyHeadingBlockId;
        const after = matchedEntries[entryIndex + distance];
        if (after?.bodyHeadingBlockId) return after.bodyHeadingBlockId;
      }
      return undefined;
    };
    for (let index = 0; index < diagnostics.length; index += 1) {
      const item = diagnostics[index];
      const entryIndex = Number(
        /\/entries\/(\d+)$/u.exec(item?.path ?? "")?.[1],
      );
      if (item && Number.isSafeInteger(entryIndex) && !item.blockId) {
        diagnostics[index] = diagnostic(
          item.code,
          item.path,
          nearestMatchedBlock(entryIndex),
        );
      }
    }
    if (matchedEntries.length < 3) {
      diagnostics.push(
        diagnostic(
          "PRINTED_TOC_INSUFFICIENT_ENTRIES",
          `candidates/${candidates.length}`,
        ),
      );
    }
    let previousLevel = 0;
    if (
      matchedEntries.some((entry) => {
        const skipped =
          previousLevel === 0
            ? entry.referenceLevel !== 1
            : entry.referenceLevel > previousLevel + 1;
        previousLevel = entry.referenceLevel;
        return skipped;
      })
    ) {
      diagnostics.push(
        diagnostic("PRINTED_TOC_LEVEL_GAP", `candidates/${candidates.length}`),
      );
    }
    const matchedCount = matchedEntries.filter(
      (entry) => entry.bodyHeadingBlockId,
    ).length;
    const coverage =
      matchedEntries.length === 0 ? 0 : matchedCount / matchedEntries.length;
    if (coverage < 0.6) {
      diagnostics.push(
        diagnostic(
          "PRINTED_TOC_LOW_COVERAGE",
          `candidates/${candidates.length}`,
        ),
      );
    }
    const firstNode = roots[range.startIndex];
    const candidateEnd = roots[candidateEndIndex] ?? firstNode;
    if (!firstNode?.position || !candidateEnd?.position) continue;
    const startByte = utf8ByteOffset(
      input.document.source,
      firstNode.position.start.offset,
    );
    const endByte = utf8ByteOffset(
      input.document.source,
      candidateEnd.position.end.offset,
    );
    const recurrenceCount = matchedEntries.filter((entry) =>
      laterHeadings.some((heading) => matchScore(entry, heading) > 0),
    ).length;
    const recurrenceCoverage =
      matchedEntries.length === 0 ? 0 : recurrenceCount / matchedEntries.length;
    const boundaryEvidenceCount = matchedEntries.filter(
      (entry) =>
        entry.numbering !== undefined ||
        printedPageEvidence(entry.sourceTitle) !== undefined ||
        dotLeader.test(entry.sourceTitle),
    ).length;
    const frontmatter = range.startIndex / Math.max(1, roots.length) <= 0.5;
    let boundaryScore = range.explicit ? 2 : 0;
    boundaryScore +=
      matchedEntries.length >= 3 ? 2 : matchedEntries.length >= 2 ? 1 : 0;
    boundaryScore +=
      boundaryEvidenceCount >= Math.min(2, matchedEntries.length) &&
      matchedEntries.length > 0
        ? 2
        : boundaryEvidenceCount > 0
          ? 1
          : 0;
    boundaryScore += frontmatter ? 1 : -3;
    if (recurrenceCoverage >= 0.5) boundaryScore += 1;
    if (!frontmatter && recurrenceCount === 0) boundaryScore -= 2;
    const boundaryConfidence =
      boundaryScore >= 6 ? "high" : boundaryScore >= 4 ? "medium" : "low";
    if (richContent && boundaryConfidence !== "high") {
      diagnostics.push(
        diagnostic(
          "PRINTED_TOC_RICH_CONTENT",
          `candidates/${candidates.length}`,
        ),
      );
    }
    const matchConfidence =
      coverage >= 0.8 && alignment.margin >= 2
        ? "high"
        : coverage >= 0.5
          ? "medium"
          : "low";
    const canApplyBoundary =
      boundaryConfidence === "high" && matchedEntries.length >= 2;
    const sourceRegionEntries = matchedEntries
      .filter(
        (entry, index, values) =>
          values.findIndex(
            (candidate) =>
              candidate.range.start_byte === entry.range.start_byte &&
              candidate.range.end_byte === entry.range.end_byte,
          ) === index,
      )
      .sort(
        (left, right) =>
          left.range.start_byte - right.range.start_byte ||
          left.range.end_byte - right.range.end_byte,
      );
    const proposedRegion = canApplyBoundary
      ? Object.freeze({
          applied: true,
          disposition: "reference_only" as const,
          entries: Object.freeze(
            sourceRegionEntries.map((entry) =>
              Object.freeze({
                ...(entry.bodyHeadingBlockId
                  ? { body_heading_block_id: entry.bodyHeadingBlockId }
                  : {}),
                range: entry.range,
                reference_level: entry.referenceLevel,
              }),
            ),
          ),
          kind: "printed_toc" as const,
          range: Object.freeze({
            end_byte: endByte,
            sha256: hash(sourceBytes.subarray(startByte, endByte)),
            start_byte: startByte,
          }),
          region_id: input.idFactory?.() ?? createOpaqueId("region"),
          source_path: input.sourcePath,
          source_sha256: input.sourceSha256,
        })
      : undefined;
    candidates.push(
      Object.freeze({
        alignment: Object.freeze({
          bestScore: alignment.bestScore,
          margin: alignment.margin,
          secondBestScore: alignment.secondBestScore,
        }),
        boundaryConfidence,
        canonical: false,
        confidence:
          boundaryConfidence === "high" && matchConfidence === "high"
            ? "high"
            : boundaryConfidence === "low" || matchConfidence === "low"
              ? "low"
              : "medium",
        diagnostics: Object.freeze(diagnostics.slice(0, 100)),
        endByte,
        entryCount: matchedEntries.length,
        logicalEntries: Object.freeze(
          matchedEntries.map((entry) =>
            Object.freeze({
              ...(entry.bodyHeadingBlockId
                ? { bodyHeadingBlockId: entry.bodyHeadingBlockId }
                : {}),
              ...(entry.pageIndex === undefined
                ? {}
                : { pageIndex: entry.pageIndex }),
              range: entry.range,
              referenceLevel: entry.referenceLevel,
              sourceTitle: entry.sourceTitle,
            }),
          ),
        ),
        matchedHeadingCount: matchedCount,
        matchConfidence,
        ...(proposedRegion ? { proposedRegion } : {}),
        requiresPdfEvidence,
        startByte,
      }),
    );
  }
  const canonical = candidates
    .filter((candidate) => candidate.proposedRegion)
    .sort(
      (left, right) =>
        right.entryCount - left.entryCount ||
        right.matchedHeadingCount - left.matchedHeadingCount ||
        right.alignment.bestScore - left.alignment.bestScore ||
        left.startByte - right.startByte,
    )[0];
  const canonicalRegionId = canonical?.proposedRegion?.region_id;
  const finalized = candidates.map((candidate) => {
    const isCanonical =
      canonicalRegionId !== undefined &&
      candidate.proposedRegion?.region_id === canonicalRegionId;
    const proposedRegion =
      candidate.proposedRegion && !isCanonical
        ? Object.freeze({
            ...candidate.proposedRegion,
            entries: Object.freeze(
              candidate.proposedRegion.entries.map((entry) =>
                Object.freeze({
                  range: entry.range,
                  reference_level: entry.reference_level,
                }),
              ),
            ),
          })
        : candidate.proposedRegion;
    return Object.freeze({
      ...candidate,
      canonical: isCanonical,
      ...(proposedRegion ? { proposedRegion } : {}),
    });
  });
  return Object.freeze({
    ...(canonicalRegionId ? { canonicalRegionId } : {}),
    candidates: Object.freeze(finalized),
  });
}

export function requiresSupplementalPdfEvidence(
  detection: PrintedContentsDetection,
): boolean {
  return (
    !detection.candidates.some(
      (candidate) => candidate.boundaryConfidence === "high",
    ) ||
    detection.candidates.some(
      (candidate) =>
        candidate.proposedRegion !== undefined && candidate.requiresPdfEvidence,
    )
  );
}

export function supplementalPdfPageIndices(
  detection: PrintedContentsDetection,
): readonly number[] | undefined {
  const pageIndices = [
    ...new Set(
      detection.candidates.flatMap((candidate) =>
        candidate.logicalEntries.flatMap((entry) =>
          entry.pageIndex === undefined ||
          entry.pageIndex < 0 ||
          entry.pageIndex >= 48
            ? []
            : [entry.pageIndex],
        ),
      ),
    ),
  ].sort((left, right) => left - right);
  return pageIndices.length > 0 ? Object.freeze(pageIndices) : undefined;
}
