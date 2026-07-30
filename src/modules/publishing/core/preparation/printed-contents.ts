import { createHash } from "node:crypto";

import { createOpaqueId } from "@/domain/ids";
import {
  reconstructPrintedLayoutRows,
  type LayoutEvidence,
} from "@/modules/publishing/core/preparation/layout-evidence";
import type {
  ConfirmedSourceRegion,
  NormalizedDocument,
  NormalizedHeading,
  TransientDocumentNode,
} from "@/modules/publishing/core/preparation/document-model";
import { SourceTextIndex } from "@/modules/publishing/core/preparation/source-text-index";

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

type AlignedEntry = ExtractedEntry &
  (
    | {
        readonly alignment: {
          readonly bodyHeadingBlockId: string;
          readonly state: "matched";
        };
      }
    | {
        readonly alignment: {
          readonly state: "ambiguous" | "unmatched";
        };
      }
  );

function alignedBodyHeadingBlockId(entry: AlignedEntry): string | undefined {
  return entry.alignment.state === "matched"
    ? entry.alignment.bodyHeadingBlockId
    : undefined;
}

interface MatchCandidate {
  readonly entryIndex: number;
  readonly headingIndex: number;
  readonly score: number;
}

interface HeadingMatchFacts {
  readonly latinCount: number;
  readonly majorOrdinal?: string;
  readonly normalizedTitle: string;
  readonly numbering?: PrintedHeadingEvidence;
  readonly plainTitle: string;
  readonly repairedNumber?: {
    readonly compact: string;
    readonly title: string;
  };
  readonly titleLength: number;
}

interface TextSimilarityIndex {
  readonly bigramsByValue: Map<string, ReadonlyMap<string, number>>;
  readonly characterCountsByValue: Map<string, ReadonlyMap<string, number>>;
  readonly characterLengthsByValue: Map<string, number>;
}

export interface PrintedContentsDocumentIndex {
  readonly document: NormalizedDocument;
  readonly headingFactsByBlockId: ReadonlyMap<string, HeadingMatchFacts>;
  readonly rootTitleByNode: ReadonlyMap<TransientDocumentNode, string>;
  readonly sourceBytes: Buffer;
  readonly sourceIndex: SourceTextIndex;
  readonly sourceSha256: string;
  readonly sourceRegionHeadingIndexes: ReadonlyMap<string, number>;
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
  /^(?:序|序言|前言|中文版序(?:[0-9零〇一二三四五六七八九十]+)?|第\s*[0-9零〇一二三四五六七八九十百千]+\s*版\s*前言|译者序|出版者的话|关于作者|专家指导委员会|作者简介|译者简介|教学建议|preface(?:\s+to\s+(?:the\s+)?[\p{L}\p{N} -]+\s+edition)?|foreword|prologue)$/iu;
const contextualEntryTitle =
  /^(?:参考文献(?:说明)?|参考资料|索引|后记|致谢|术语表|图片来源|符号索引|思考题|本章注记|附录注记|自测题|练习题答案|习题|练习|课后习题和问题|复习题|人物专访|编程作业|bibliographic notes|bibliography|references|index|afterword|acknowledg(?:e)?ments?|credits|practice exercises|further reading|review questions|exercises)$/iu;
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
const explicitMajorEntryPrefix = new RegExp(
  `^(?:第\\s*[0-9零〇一二三四五六七八九十百千]+\\s*(?:章|篇|部分|部)|(?:chapter|chap\\.?)\\s*(?:[0-9ivxlcdm]+|[A-Z]|${englishOrdinalWord})|part\\s*(?:[0-9ivxlcdm]+|${englishOrdinalWord})|附录|appendix)(?:\\s|[:：]|$)`,
  "iu",
);
const topLevelBackmatterTitle =
  /^(?:参考文献|参考资料|术语表|(?:译)?后记|图片来源|符号索引|(?:表|图|主题|作者)?索引|致谢|bibliography|references|glossary|(?:author|subject)\s+index|index|afterword|acknowledg(?:e)?ments?|credits)$/iu;
const localUnnumberedAppendixTitle = /^(?:附录|appendix)\s*[:：]/iu;
const localEnglishUnnumberedAppendixTitle = /^appendix\s*[:：]/iu;
const printedNumberingPrefix = new RegExp(
  `^(?:\\\\?\\*\\s*)?(?:第\\s*[0-9零〇一二三四五六七八九十百千]+\\s*(?:章|篇|部分|部)|(?:chapter|chap\\.?)\\s*(?:[0-9ivxlcdm]+|[A-Z]|${englishOrdinalWord})|part\\s*(?:[0-9ivxlcdm]+|${englishOrdinalWord})|附录\\s*[A-Za-z0-9一二三四五六七八九十]*(?:\\s*\\.\\s*\\d+){0,3}|[A-Z]\\s*\\.\\s*\\d+(?:\\s*\\.\\s*\\d+){0,2}|\\d+[A-Z](?:\\s*\\.\\s*\\d+){0,2}|\\d+\\s+\\d+(?:\\s*[ .]\\s*\\d+){1,2}|\\d+(?:\\s*\\.\\s*\\d+){1,3}|\\d{1,3}(?=\\s+[\\p{L}“”'"（(]))`,
  "iu",
);
const namedHeading = new RegExp(
  `^(?:第\\s*([0-9零〇一二三四五六七八九十百千]+)\\s*(章|篇|部分|部)|(?:chapter|chap\\.?)\\s*([0-9ivxlcdm]+|[A-Z]|${englishOrdinalWord})(?=\\s|$|[—–:：.-])|part\\s*([0-9ivxlcdm]+|${englishOrdinalWord})(?=\\s|$|[—–:：.-]))`,
  "iu",
);

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function withoutControlCharacters(value: string): string {
  let output = "";
  let retainedStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code > 8 &&
      code !== 11 &&
      code !== 12 &&
      (code < 14 || code > 31) &&
      code !== 127
    ) {
      continue;
    }
    output += `${value.slice(retainedStart, index)} `;
    retainedStart = index + 1;
  }
  return retainedStart === 0 ? value : output + value.slice(retainedStart);
}

function plainTitle(value: string): string {
  return withoutControlCharacters(value)
    .normalize("NFKC")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/u, "")
    .replace(/^\\+\s*(?=(?:[A-Z]\s*\.\s*)?\d)/u, "")
    .replace(
      /^\d{1,5}\s+(?=(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部)|(?:chapter|part|appendix)\b))/iu,
      "",
    )
    .replace(/\$(\\(?:dots|ldots|cdots)\s+(?:\d{1,5}|[ivxlcdm]+))\$/giu, "$1")
    .replace(/\$([^$\n]{1,256})\$/gu, "$1")
    .replace(/\^\{\\prime\}/gu, "'")
    .replace(
      /\s+\^\{\d+\}(?=\s*(?:(?:\.(?:\s*\.)+|…+|·(?:\s*·)+|_(?:\s*_)+)|$))/gu,
      "",
    )
    .replace(/[ \t]{2,}$/u, "")
    .trim();
}

export function inferPrintedHeadingEvidence(
  value: string,
): PrintedHeadingEvidence | undefined {
  const plain = plainTitle(value)
    .replace(/^\\?\*\s*/u, "")
    .replace(/[．。]/gu, ".")
    .replace(/\s*\.\s*/gu, ".");
  if (localEnglishUnnumberedAppendixTitle.test(plain)) return;
  const appendix =
    /^(?:附录(?=\s|[:：]|$|[A-Za-z0-9一二三四五六七八九十])|appendix\b)\s*(?<number>[A-Za-z0-9一二三四五六七八九十]+(?:\.\d+){0,3})?/iu.exec(
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
  const named = namedHeading.exec(plain);
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
  const spacedDecimal =
    /^(\d)\s+(\d+(?:\s*[ .]\s*\d+){1,2})(?=\s|、|:|：)/u.exec(plain);
  if (spacedDecimal?.[1] && spacedDecimal[2]) {
    const key = `${spacedDecimal[1]}.${spacedDecimal[2].replace(/\s*[ .]\s*/gu, ".")}`;
    return Object.freeze({
      kind: "decimal",
      key,
      level: Math.min(4, key.split(".").length),
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
  const ambiguousSpacedChapter =
    /^(\d{2,})\s+\d+(?:\s*\.\s*\d+){1,2}(?=\s|、|:|：)/u.exec(plain)?.[1];
  if (ambiguousSpacedChapter) {
    return Object.freeze({
      kind: "chapter",
      key: ambiguousSpacedChapter,
      level: 1,
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
  let insideSupplementalPart = false;
  let insideAppendix = false;
  let insideLocalAppendixGroup = false;
  let alphaSectionLevel: number | undefined;
  let reviewGroupLevel: number | undefined;
  let previousLevel = 0;
  const hasLaterBodyMajor: boolean[] = Array.from({ length: values.length });
  let laterBodyMajor = false;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    hasLaterBodyMajor[index] = laterBodyMajor;
    const value = values[index] ?? "";
    const semanticTitle =
      printedPageEvidence(value)?.title ?? plainTitle(value);
    const kind = inferPrintedHeadingEvidence(semanticTitle)?.kind;
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
      const semanticTitle =
        printedPageEvidence(value)?.title ?? plainTitle(value);
      const numbering = inferPrintedHeadingEvidence(semanticTitle);
      const reviewParent = chapterReviewParentTitle.test(semanticTitle);
      const reviewChild = chapterReviewChildTitle.test(semanticTitle);
      const alphaSection =
        /^(\d{1,3}[A-Z])((?:\.\d+){0,2})(?=\s|、|:|：)/iu.exec(semanticTitle);
      const suppliedLevel = options.referenceLevels?.get(index);
      let level: number;
      if (suppliedLevel !== undefined) {
        level = Math.min(4, Math.max(1, suppliedLevel));
        if (numbering?.kind === "appendix" && level === 1) {
          insidePart = false;
          insideSupplementalPart = false;
          insideAppendix = true;
        } else if (numbering?.kind === "appendix") {
          insidePart = level >= 3;
          insideSupplementalPart = false;
          insideAppendix = false;
        } else if (
          numbering?.kind === "part" ||
          ((numbering?.kind === "chapter" || numbering?.kind === "decimal") &&
            level > numbering.level)
        ) {
          insidePart = true;
          insideSupplementalPart =
            numbering?.kind === "part" &&
            /(?:附录|appendix)/iu.test(semanticTitle);
          insideAppendix = false;
        } else if (
          (numbering?.kind === "chapter" || numbering?.kind === "decimal") &&
          level === numbering.level
        ) {
          insidePart = false;
          insideSupplementalPart = false;
          insideAppendix = false;
        }
      } else if (
        numbering?.kind === "part" &&
        options.localPartIndexes?.has(index)
      ) {
        level = 3;
      } else if (numbering?.kind === "part") {
        insidePart = true;
        insideSupplementalPart = /(?:附录|appendix)/iu.test(semanticTitle);
        insideAppendix = false;
        insideLocalAppendixGroup = false;
        level = 1;
      } else if (
        localUnnumberedAppendixTitle.test(semanticTitle) &&
        previousLevel > 1
      ) {
        level = insideLocalAppendixGroup ? 3 : 2;
        insideLocalAppendixGroup = true;
      } else if (numbering?.kind === "appendix") {
        const chapterScopedAppendix =
          numbering.level === 1 &&
          /^(?:附录|appendix)\s*\d{1,3}[A-Z](?=\s|$|[.:：]|\p{Script=Han})/iu.test(
            semanticTitle,
          );
        if (chapterScopedAppendix) {
          level = insidePart ? 3 : 2;
          insideAppendix = false;
          insideLocalAppendixGroup = false;
        } else if (numbering.level > 1) {
          level = Math.min(
            4,
            Math.max(2, numbering.level + (insidePart ? 1 : 0)),
          );
          insideAppendix = false;
          insideLocalAppendixGroup = false;
        } else if (insideSupplementalPart) {
          level = 2;
          insideAppendix = false;
          insideLocalAppendixGroup = false;
        } else {
          insidePart = false;
          insideSupplementalPart = false;
          insideAppendix = true;
          insideLocalAppendixGroup = false;
          level = 1;
        }
      } else if (numbering?.kind === "chapter") {
        insideAppendix = false;
        insideLocalAppendixGroup = false;
        level = insidePart ? 2 : 1;
      } else if (numbering?.kind === "decimal") {
        insideLocalAppendixGroup = false;
        level = Math.min(4, numbering.level + (insidePart ? 1 : 0));
      } else if (topLevelBackmatterTitle.test(semanticTitle)) {
        if (previousLevel > 1 && hasLaterBodyMajor[index]) {
          level = Math.min(4, 2 + (insidePart ? 1 : 0));
        } else {
          insidePart = false;
          insideSupplementalPart = false;
          insideAppendix = false;
          insideLocalAppendixGroup = false;
          level = 1;
        }
      } else if (
        /^(?:课后习题和问题|end-of-chapter questions|参考文献(?:说明)?|练习题答案|家庭作业|思考题|本章注记|附录注记|习题|练习|bibliographic notes|exercises|review questions)$/iu.test(
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
      if (
        numbering === undefined &&
        alphaSectionLevel !== undefined &&
        !(topLevelBackmatterTitle.test(semanticTitle) && level === 1)
      ) {
        level = Math.max(level, Math.min(4, alphaSectionLevel + 1));
      }
      if (reviewParent) {
        reviewGroupLevel = level;
      } else if (reviewChild && reviewGroupLevel !== undefined) {
        level = Math.min(4, reviewGroupLevel + 1);
      } else if (numbering) {
        reviewGroupLevel = undefined;
      }
      if (alphaSection) {
        const nestedDepth = alphaSection[2]?.match(/\./gu)?.length ?? 0;
        alphaSectionLevel = Math.max(1, level - nestedDepth);
      } else if (
        numbering?.kind === "part" ||
        numbering?.kind === "chapter" ||
        numbering?.kind === "appendix" ||
        numbering?.kind === "decimal" ||
        (topLevelBackmatterTitle.test(semanticTitle) && level === 1)
      ) {
        alphaSectionLevel = undefined;
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
  if (
    /^(?:chapter|part)\s+(?:[0-9ivxlcdm]+|[A-Z])\s+.*\b(?:windows|macos|android)\s+\d+\s*$/iu.test(
      plain,
    )
  ) {
    return;
  }
  const followedBySummary =
    /^(?<title>.+?)\s+(?<page>\d+|[ivxlcdm]+)\s+(?:小结|summary)(?:\s*[/／].*)?$/iu.exec(
      plain,
    );
  if (followedBySummary?.groups?.title && followedBySummary.groups.page) {
    return Object.freeze({
      pageLabel: followedBySummary.groups.page,
      title: followedBySummary.groups.title.trim(),
    });
  }
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
  const attached = /^(?<title>.+[)\]}>])(?<page>\d{1,5})\s*$/u.exec(plain);
  if (attached?.groups?.title && attached.groups.page) {
    return Object.freeze({
      pageLabel: attached.groups.page,
      title: attached.groups.title.trim(),
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
  const comparableTitle = withoutPage
    .replace(
      /\\operatorname\*?\s*\{\s*([^{}\n]{1,64}?)\s*\}/gu,
      (_match, content: string) => content.replace(/\s+/gu, ""),
    )
    .replace(/\s*\{\s*\\cdot\s*\}\s*/gu, ".")
    .replace(/\\quad\b/gu, " ")
    .replace(/\$([^$\n]{1,256})\$/gu, "$1");
  const numbering = inferPrintedHeadingEvidence(comparableTitle);
  const withoutNumber = numbering
    ? comparableTitle.slice(
        printedNumberingPrefix.exec(comparableTitle)?.[0].length ?? 0,
      )
    : comparableTitle;
  const comparisonTitle = withoutNumber.trim()
    ? withoutNumber
    : comparableTitle;
  return comparisonTitle
    .replace(/\\(?:dots|ldots|cdots)\b/giu, "")
    .replace(/\\mathrm\s*\{?\s*([A-Za-z])\s*\}?/gu, "$1")
    .replace(/\*+\s*$/gu, "")
    .replace(/[$\\{}]/gu, "")
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
  if (/^\s*(?:#{1,6}\s+)?\d+\s+\d+(?:\s*[ .]\s*\d+){1,2}\s+/u.test(value)) {
    return Object.freeze([{ end: value.length, start: 0, text: value }]);
  }
  const boundary = new RegExp(embeddedPrintedEntryBoundary.source, "giu");
  const segments: { end: number; start: number; text: string }[] = [];
  let cursor = 0;
  for (const match of value.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end <= cursor || end >= value.length) continue;
    if (
      /(?:附录|appendix)\s+[A-Z一二三四五六七八九十]\s*$/iu.test(
        value.slice(cursor, end),
      )
    ) {
      continue;
    }
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
  readonly repairableContextualTitles?: ReadonlySet<string>;
  readonly source: string;
  readonly sourceBytes: Uint8Array;
  readonly sourceIndex: SourceTextIndex;
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
      const contextualTitle = plain
        .replace(new RegExp(`\\s*${dotLeader.source}\\s*$`, "iu"), "")
        .trim();
      if (
        hasPrintedPage ||
        numbering ||
        detachedSectionNumber.test(plain) ||
        frontmatterEntryTitle.test(plain) ||
        (contextualEntryTitle.test(contextualTitle) &&
          (contextualTitle === plain ||
            input.repairableContextualTitles?.has(
              normalizedTitle(contextualTitle),
            )))
      ) {
        const title = normalizedTitle(segment.text);
        const printed = printedPageEvidence(plain);
        const pageOnly =
          printed !== undefined && normalizedTitle(printed.title) === "";
        if (title || pageOnly) {
          const startOffset =
            input.block.position.start.offset + lineOffset + segment.start;
          const endOffset =
            input.block.position.start.offset + lineOffset + segment.end;
          const startByte = input.sourceIndex.byteOffsetAt(startOffset);
          const endByte = input.sourceIndex.byteOffsetAt(endOffset);
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
    if (!current.normalizedTitle) {
      const previous = merged.at(-1);
      const previousTitle = previous
        ? (printedPageEvidence(previous.sourceTitle)?.title ??
          plainTitle(previous.sourceTitle))
        : "";
      if (
        previous &&
        (chapterReviewParentTitle.test(previousTitle) ||
          chapterReviewChildTitle.test(previousTitle))
      ) {
        merged.push(
          Object.freeze({
            ...current,
            referenceLevel: previous.referenceLevel,
          }),
        );
      }
      continue;
    }
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
    const currentPrinted = printedPageEvidence(current.sourceTitle);
    const nextPrinted = next
      ? printedPageEvidence(next.sourceTitle)
      : undefined;
    const sourceGap = next
      ? next.range.start_byte - current.range.end_byte
      : Number.POSITIVE_INFINITY;
    if (
      current.numbering &&
      !currentPrinted &&
      !new RegExp(`${dotLeader.source}\\s*$`, "iu").test(
        plainTitle(current.sourceTitle),
      ) &&
      next &&
      nextPrinted &&
      !next.numbering &&
      sourceGap >= 0 &&
      sourceGap <= 4 &&
      !frontmatterEntryTitle.test(nextPrinted.title) &&
      !contextualEntryTitle.test(nextPrinted.title)
    ) {
      const sourceTitle = `${plainTitle(current.sourceTitle)} ${plainTitle(next.sourceTitle)}`;
      merged.push(
        Object.freeze({
          ...current,
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

function createTextSimilarityIndex(): TextSimilarityIndex {
  return {
    bigramsByValue: new Map(),
    characterCountsByValue: new Map(),
    characterLengthsByValue: new Map(),
  };
}

function bigrams(
  value: string,
  index: TextSimilarityIndex,
): ReadonlyMap<string, number> {
  const cached = index.bigramsByValue.get(value);
  if (cached) return cached;
  const output = new Map<string, number>();
  for (let offset = 0; offset < value.length - 1; offset += 1) {
    const key = value.slice(offset, offset + 2);
    output.set(key, (output.get(key) ?? 0) + 1);
  }
  index.bigramsByValue.set(value, output);
  return output;
}

function similarity(
  left: string,
  right: string,
  index: TextSimilarityIndex,
): number {
  if (left === right) return 1;
  if (!left || !right || Math.min(left.length, right.length) < 3) return 0;
  const leftPairs = bigrams(left, index);
  const rightPairs = bigrams(right, index);
  let overlap = 0;
  for (const [key, count] of leftPairs) {
    overlap += Math.min(count, rightPairs.get(key) ?? 0);
  }
  return (2 * overlap) / (left.length + right.length - 2);
}

function characterCounts(
  value: string,
  index: TextSimilarityIndex,
): ReadonlyMap<string, number> {
  const cached = index.characterCountsByValue.get(value);
  if (cached) return cached;
  const result = new Map<string, number>();
  let length = 0;
  for (const character of value) {
    result.set(character, (result.get(character) ?? 0) + 1);
    length += 1;
  }
  index.characterCountsByValue.set(value, result);
  index.characterLengthsByValue.set(value, length);
  return result;
}

function characterSimilarity(
  left: string,
  right: string,
  index: TextSimilarityIndex,
): number {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const leftCounts = characterCounts(left, index);
  const rightCounts = characterCounts(right, index);
  let overlap = 0;
  for (const [character, count] of leftCounts) {
    overlap += Math.min(count, rightCounts.get(character) ?? 0);
  }
  return (
    (2 * overlap) /
    ((index.characterLengthsByValue.get(left) ?? 0) +
      (index.characterLengthsByValue.get(right) ?? 0))
  );
}

function repairableDecimalPrefix(
  value: string,
): { readonly compact: string; readonly title: string } | undefined {
  const plain = plainTitle(value);
  const match =
    /^(?<number>\d+(?:(?:\s*\.\s*|\s+)\d+){0,3})\.?\s+(?<title>.+)$/u.exec(
      plain,
    );
  const number = match?.groups?.number;
  const title = match?.groups?.title?.trim();
  if (!number || !title) return;
  if (/^\d{2,}\s+\d/u.test(number)) return;
  return Object.freeze({
    compact: number.replace(/[.\s]/gu, ""),
    title,
  });
}

function numericMajorOrdinal(
  evidence: PrintedHeadingEvidence | undefined,
  value: string,
): string | undefined {
  if (!evidence) return;
  if (evidence.kind === "decimal") return evidence.key.split(".")[0];
  if (evidence.kind !== "chapter") return;
  return /\d+/u.exec(plainTitle(value))?.[0];
}

function createHeadingMatchFacts(
  heading: NormalizedHeading,
): HeadingMatchFacts {
  const plain = plainTitle(heading.sourceTitle);
  const numbering = inferPrintedHeadingEvidence(plain);
  const normalized = normalizedTitle(plain, false);
  const majorOrdinal = numbering
    ? numbering.kind === "decimal"
      ? numbering.key.split(".")[0]
      : numbering.kind === "chapter"
        ? /\d+/u.exec(plain)?.[0]
        : undefined
    : undefined;
  const repairedNumber = repairableDecimalPrefix(plain);
  return Object.freeze({
    latinCount: normalized.match(/[a-z]/giu)?.length ?? 0,
    ...(majorOrdinal ? { majorOrdinal } : {}),
    normalizedTitle: normalized,
    ...(numbering ? { numbering } : {}),
    plainTitle: plain,
    ...(repairedNumber ? { repairedNumber } : {}),
    titleLength: [...normalized].length,
  });
}

export function createPrintedContentsDocumentIndex(
  document: NormalizedDocument,
): PrintedContentsDocumentIndex {
  const sourceBytes = Buffer.from(document.source, "utf8");
  return Object.freeze({
    document,
    headingFactsByBlockId: new Map(
      document.headings.map((heading) => [
        heading.blockId,
        createHeadingMatchFacts(heading),
      ]),
    ),
    rootTitleByNode: new Map(
      (document.root.children ?? []).map((node) => [node, rootTitle(node)]),
    ),
    sourceBytes,
    sourceIndex: new SourceTextIndex(document.source),
    sourceRegionHeadingIndexes: new Map(
      document.headings.map((heading, index) => [heading.blockId, index]),
    ),
    sourceSha256: hash(sourceBytes),
  });
}

function matchScore(
  entry: ExtractedEntry,
  heading: NormalizedHeading,
  headingFacts: HeadingMatchFacts,
  similarityIndex: TextSimilarityIndex,
  allowNumberOnly = false,
  allowMajorSectionFallback = false,
): number {
  if (entry.sourceTitle.includes("�") || heading.sourceTitle.includes("�")) {
    return 0;
  }
  const headingTitle = headingFacts.normalizedTitle;
  const headingNumber = headingFacts.numbering;
  const repairedHeadingNumber = headingFacts.repairedNumber;
  const supplementalPartToAppendix =
    entry.numbering?.kind === "part" &&
    headingNumber?.kind === "appendix" &&
    /(?:附录|appendix)/iu.test(plainTitle(entry.sourceTitle));
  const supplementalTitle = entry.normalizedTitle.replace(
    /^(?:附录|appendix)/iu,
    "",
  );
  const titleScore = Math.max(
    similarity(entry.normalizedTitle, headingTitle, similarityIndex),
    supplementalPartToAppendix
      ? similarity(supplementalTitle, headingTitle, similarityIndex)
      : 0,
  );
  const majorSectionFallback =
    allowMajorSectionFallback &&
    entry.numbering?.kind === "chapter" &&
    headingNumber?.kind === "decimal" &&
    numericMajorOrdinal(entry.numbering, entry.sourceTitle) ===
      headingFacts.majorOrdinal &&
    titleScore >= 0.7;
  const decimalNumberingEquivalent =
    entry.numbering?.kind === "decimal" &&
    ((headingNumber?.kind === "decimal" &&
      entry.numbering.key.replaceAll(".", "") ===
        headingNumber.key.replaceAll(".", "") &&
      titleScore >= 0.9) ||
      (repairedHeadingNumber !== undefined &&
        entry.numbering.key.replaceAll(".", "") ===
          repairedHeadingNumber.compact &&
        similarity(
          entry.normalizedTitle,
          normalizedTitle(repairedHeadingNumber.title, false),
          similarityIndex,
        ) >= 0.9));
  const incompatibleMathRepresentations =
    /[\u2070-\u209f]/u.test(entry.sourceTitle) &&
    /\\[A-Za-z]+(?:\s*\{|\b)/u.test(heading.sourceTitle) &&
    titleScore < 0.62;
  const numberEqual =
    decimalNumberingEquivalent ||
    (entry.numbering !== undefined &&
      headingNumber !== undefined &&
      entry.numbering.key === headingNumber.key);
  const numberConflict =
    entry.numbering &&
    headingNumber &&
    entry.numbering.key !== headingNumber.key &&
    !decimalNumberingEquivalent &&
    !supplementalPartToAppendix;
  const detachedMajorTitle =
    (entry.numbering?.kind === "part" || entry.numbering?.kind === "chapter") &&
    headingNumber === undefined &&
    titleScore >= 0.7;
  const implicitSectionNumber =
    entry.numbering === undefined &&
    headingNumber?.kind === "decimal" &&
    entry.normalizedTitle.length >= 2;
  const genericAppendix =
    entry.numbering?.kind === "appendix" && entry.numbering.key === "appendix";
  const acceptsNumberOnly = allowNumberOnly || entry.normalizedTitle.length < 2;
  const entryTitleLength = [...entry.normalizedTitle].length;
  const headingTitleLength = headingFacts.titleLength;
  const titleLengthRatio =
    Math.min(entryTitleLength, headingTitleLength) /
    Math.max(1, entryTitleLength, headingTitleLength);
  const bilingualExpansion =
    headingTitle.includes(entry.normalizedTitle) &&
    headingFacts.latinCount >= 4 &&
    (entry.normalizedTitle.match(/[a-z]/giu)?.length ?? 0) < 4;
  const canUseCharacterRepair = titleLengthRatio >= 0.25 && !bilingualExpansion;
  const effectiveTitleScore = numberEqual
    ? Math.max(
        titleScore,
        canUseCharacterRepair
          ? characterSimilarity(
              entry.normalizedTitle,
              headingTitle,
              similarityIndex,
            )
          : 0,
      )
    : titleScore;
  if (
    incompatibleMathRepresentations ||
    (numberConflict && !majorSectionFallback) ||
    (genericAppendix && titleScore < 0.62) ||
    (!numberEqual && !majorSectionFallback && titleScore < 0.62) ||
    (numberEqual &&
      !acceptsNumberOnly &&
      effectiveTitleScore < (canUseCharacterRepair ? 0.25 : 0.55))
  ) {
    return 0;
  }
  return (
    Math.round(effectiveTitleScore * 10) +
    (numberEqual ? 8 : 0) +
    (majorSectionFallback ? 8 : 0) +
    (majorSectionFallback && headingNumber?.level === 2 ? 2 : 0) +
    (implicitSectionNumber ? 2 : 0) +
    (detachedMajorTitle ? 20 : 0)
  );
}

function recoveredMatchedSourceTitle(
  entry: ExtractedEntry,
  headingFacts: HeadingMatchFacts,
  recoverOmittedDecimalNumber: boolean,
  similarityIndex: TextSimilarityIndex,
): string {
  const sourceTitle = plainTitle(entry.sourceTitle);
  const bodyTitle = headingFacts.plainTitle;
  const headingNumber = headingFacts.numbering;
  const matchedNumberEqual =
    entry.numbering !== undefined &&
    headingNumber !== undefined &&
    entry.numbering.kind === headingNumber.kind &&
    entry.numbering.key === headingNumber.key;
  const headingTitle = headingFacts.normalizedTitle;
  const repairedHeadingNumber = headingFacts.repairedNumber;
  const majorSectionFallback =
    entry.numbering?.kind === "chapter" &&
    headingNumber?.kind === "decimal" &&
    numericMajorOrdinal(entry.numbering, entry.sourceTitle) ===
      headingFacts.majorOrdinal &&
    similarity(entry.normalizedTitle, headingTitle, similarityIndex) >= 0.7;
  const printed = printedPageEvidence(sourceTitle);
  const bodyTitleWithPage = (): string => {
    if (!printed) return bodyTitle;
    const suffix =
      /(?<suffix>\s*(?:\.(?:\s*\.)+|…+|·(?:\s*·)+|_(?:\s*_)+|\s+)\s*(?:[ivxlcdm]+|\d{1,5})\s*)$/iu.exec(
        sourceTitle,
      )?.groups?.suffix;
    return `${bodyTitle}${suffix ?? `  ${printed.pageLabel}`}`;
  };
  const repairedBodyTitleWithPage = (): string | undefined => {
    if (
      entry.numbering?.kind !== "decimal" ||
      repairedHeadingNumber?.compact !== entry.numbering.key.replaceAll(".", "")
    ) {
      return;
    }
    const repairedBodyTitle = `${entry.numbering.key} ${repairedHeadingNumber.title}`;
    if (!printed) return repairedBodyTitle;
    const suffix =
      /(?<suffix>\s*(?:\.(?:\s*\.)+|…+|·(?:\s*·)+|_(?:\s*_)+|\s+)\s*(?:[ivxlcdm]+|\d{1,5})\s*)$/iu.exec(
        sourceTitle,
      )?.groups?.suffix;
    return `${repairedBodyTitle}${suffix ?? `  ${printed.pageLabel}`}`;
  };
  const damagedPrintedNumber =
    headingNumber?.kind === "decimal" &&
    /^\d+\s+\d/u.test(sourceTitle) &&
    (() => {
      const prefix = /^(?<number>\d+(?:[ .]\d+){1,3})\s+/u.exec(sourceTitle)
        ?.groups?.number;
      return (
        prefix !== undefined &&
        prefix.replace(/[ .]/gu, "") === headingNumber.key.replaceAll(".", "")
      );
    })();
  if (damagedPrintedNumber) return bodyTitleWithPage();
  if (majorSectionFallback) return sourceTitle;
  if (
    printed &&
    !new RegExp(`(?:${printed.pageLabel})\\s*$`, "iu").test(sourceTitle)
  ) {
    return `${printed.title}  ${printed.pageLabel}`;
  }
  const bodyUsesCanonicalNumber =
    entry.numbering?.kind === "decimal" &&
    bodyTitle.startsWith(entry.numbering.key) &&
    /^\s/u.test(bodyTitle.slice(entry.numbering.key.length));
  if (
    entry.numbering?.kind === "decimal" &&
    sourceTitle.startsWith(entry.numbering.key) &&
    !bodyUsesCanonicalNumber &&
    repairedHeadingNumber?.compact === entry.numbering.key.replaceAll(".", "")
  ) {
    return repairedBodyTitleWithPage() ?? sourceTitle;
  }
  if (
    dotLeader.test(bodyTitle) ||
    /^\$?k\$?\s*习题(?:\s|$).*\$?k\$?$/iu.test(bodyTitle)
  ) {
    return sourceTitle;
  }
  if (
    (entry.numbering?.kind === "part" || entry.numbering?.kind === "chapter") &&
    headingNumber === undefined
  ) {
    return sourceTitle;
  }
  if (
    recoverOmittedDecimalNumber &&
    entry.numbering === undefined &&
    headingNumber?.kind === "decimal" &&
    similarity(entry.normalizedTitle, headingTitle, similarityIndex) >= 0.9
  ) {
    return bodyTitleWithPage();
  }
  if (
    matchedNumberEqual &&
    /\\[A-Za-z]+/u.test(sourceTitle) &&
    headingTitle.startsWith(entry.normalizedTitle)
  ) {
    return sourceTitle;
  }
  if (
    matchedNumberEqual &&
    /[\uE000-\uF8FF]/u.test(sourceTitle) &&
    !/[\uE000-\uF8FF]/u.test(bodyTitle)
  ) {
    const bodyMathCommands = bodyTitle.match(/\\[A-Za-z]+/gu) ?? [];
    const privateGlyphs = sourceTitle.match(/[\uE000-\uF8FF]/gu) ?? [];
    if (bodyMathCommands.length >= privateGlyphs.length) {
      let commandIndex = 0;
      return sourceTitle.replace(/[\uE000-\uF8FF]/gu, () => {
        const command = bodyMathCommands[commandIndex];
        commandIndex += 1;
        return command ?? "";
      });
    }
  }
  if (similarity(entry.normalizedTitle, headingTitle, similarityIndex) >= 0.9) {
    return sourceTitle;
  }
  const entryLength = [...entry.normalizedTitle].length;
  const headingLength = [...headingTitle].length;
  const knownOcrPhraseCorruption =
    entry.normalizedTitle.includes("仕么") && headingTitle.includes("什么");
  if (entryLength >= headingLength && !knownOcrPhraseCorruption) {
    return sourceTitle;
  }
  if (
    entryLength >= 3 &&
    !knownOcrPhraseCorruption &&
    characterSimilarity(entry.normalizedTitle, headingTitle, similarityIndex) <
      0.4
  ) {
    return sourceTitle;
  }
  if (!printed) return bodyTitle;
  return bodyTitleWithPage();
}

function hasSupportedOmittedDecimalNumber(
  entries: readonly ExtractedEntry[],
  entryIndex: number,
  headingFacts: HeadingMatchFacts,
): boolean {
  const previous = entries[entryIndex - 1]?.numbering;
  const next = entries[entryIndex + 1]?.numbering;
  const headingNumber = headingFacts.numbering;
  if (
    previous?.kind !== "decimal" ||
    next?.kind !== "decimal" ||
    headingNumber?.kind !== "decimal"
  ) {
    return false;
  }
  const previousParts = previous.key.split(".").map(Number);
  const headingParts = headingNumber.key.split(".").map(Number);
  const nextParts = next.key.split(".").map(Number);
  if (
    previousParts.length < 2 ||
    previousParts.length !== headingParts.length ||
    previousParts.length !== nextParts.length
  ) {
    return false;
  }
  const prefixLength = previousParts.length - 1;
  if (
    previousParts
      .slice(0, prefixLength)
      .some(
        (part, index) =>
          part !== headingParts[index] || part !== nextParts[index],
      )
  ) {
    return false;
  }
  const previousOrdinal = previousParts[prefixLength];
  const headingOrdinal = headingParts[prefixLength];
  const nextOrdinal = nextParts[prefixLength];
  return (
    previousOrdinal !== undefined &&
    headingOrdinal === previousOrdinal + 1 &&
    nextOrdinal === headingOrdinal + 1
  );
}

function monotonicMatches(
  entries: readonly ExtractedEntry[],
  headings: readonly NormalizedHeading[],
  headingFacts: readonly HeadingMatchFacts[],
  similarityIndex: TextSimilarityIndex,
  options: {
    readonly allowMajorSectionFallback?: boolean;
    readonly allowNumberOnly?: boolean;
    readonly requireNumberingForNumberedEntries?: boolean;
  } = {},
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
  const repairedNumberedHeadings = new Map<string, number[]>();
  for (const [index, heading] of headings.entries()) {
    const facts = headingFacts[index] ?? createHeadingMatchFacts(heading);
    const title = facts.normalizedTitle;
    exactHeadings.set(title, [...(exactHeadings.get(title) ?? []), index]);
    const number = facts.numbering;
    if (number) {
      numberedHeadings.set(number.key, [
        ...(numberedHeadings.get(number.key) ?? []),
        index,
      ]);
    }
    const repairedNumber = facts.repairedNumber;
    if (repairedNumber) {
      repairedNumberedHeadings.set(repairedNumber.compact, [
        ...(repairedNumberedHeadings.get(repairedNumber.compact) ?? []),
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
      if (entry.numbering.kind === "decimal") {
        for (const index of repairedNumberedHeadings.get(
          entry.numbering.key.replaceAll(".", ""),
        ) ?? []) {
          indexes.add(index);
        }
      }
    }
    if (indexes.size === 0) {
      for (const [headingIndex, heading] of headings.entries()) {
        const headingTitle =
          headingFacts[headingIndex]?.normalizedTitle ??
          createHeadingMatchFacts(heading).normalizedTitle;
        if (
          headingTitle.slice(0, 4) === entry.normalizedTitle.slice(0, 4) ||
          similarity(entry.normalizedTitle, headingTitle, similarityIndex) >=
            0.62
        ) {
          indexes.add(headingIndex);
        }
        if (indexes.size >= 50) break;
      }
    }
    for (const headingIndex of indexes) {
      const heading = headings[headingIndex];
      if (!heading) continue;
      const facts =
        headingFacts[headingIndex] ?? createHeadingMatchFacts(heading);
      if (
        options.requireNumberingForNumberedEntries &&
        entry.numbering &&
        !facts.numbering
      ) {
        continue;
      }
      const score = matchScore(
        entry,
        heading,
        facts,
        similarityIndex,
        options.allowNumberOnly,
        options.allowMajorSectionFallback,
      );
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
  const rows = reconstructPrintedLayoutRows(evidence).filter((record) => {
    const printed = printedPageEvidence(record.text);
    const title = printed?.title ?? plainTitle(record.text);
    return (
      !contentsTitle.test(title.trim().normalize("NFKC")) &&
      (inferPrintedHeadingEvidence(record.text) !== undefined ||
        printed !== undefined)
    );
  });
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
  const numberedParentByPage = new Map<
    number,
    { readonly indent: number; readonly level: number }
  >();
  for (const [index, row] of rows.entries()) {
    const numbering = inferPrintedHeadingEvidence(row.text);
    let level = numbering ? inferredLevels[index] : undefined;
    if (numbering && level) {
      numberedParentByPage.set(row.pageIndex, {
        indent: row.indent,
        level,
      });
    }
    const semanticTitle =
      printedPageEvidence(row.text)?.title ?? plainTitle(row.text);
    const parent = numberedParentByPage.get(row.pageIndex);
    if (
      !numbering &&
      !frontmatterEntryTitle.test(semanticTitle) &&
      !topLevelBackmatterTitle.test(semanticTitle) &&
      parent &&
      row.indent >= parent.indent + 8
    ) {
      level = Math.min(4, parent.level + 1);
    }
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
  const selected = rows.filter((row) => {
    const printed = printedPageEvidence(row.text);
    const numbering = inferPrintedHeadingEvidence(row.text);
    return (
      candidatePages.has(row.pageIndex) &&
      (printed !== undefined ||
        numbering?.kind === "part" ||
        numbering?.kind === "chapter" ||
        numbering?.kind === "appendix") &&
      !contentsTitle.test(
        (printed?.title ?? plainTitle(row.text)).trim().normalize("NFKC"),
      )
    );
  });
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

function repairableContextualTitles(
  evidence: LayoutEvidence | undefined,
): ReadonlySet<string> {
  if (!evidence) return new Set();
  const rows =
    evidence.source === "native-pdf" || evidence.source === "ocr"
      ? reconstructPrintedLayoutRows(evidence).map((row) => row.text)
      : evidence.records.flatMap((record) =>
          record.pageLabelSupplemented && record.text ? [record.text] : [],
        );
  return new Set(
    rows.flatMap((row) => {
      const printed = printedPageEvidence(row);
      const title = printed?.title ?? plainTitle(row);
      return printed && contextualEntryTitle.test(title)
        ? [normalizedTitle(title)]
        : [];
    }),
  );
}

function attachReliableLayoutPageIndexes(
  entries: readonly ExtractedEntry[],
  evidence: LayoutEvidence | undefined,
): readonly ExtractedEntry[] {
  if (!evidence) return entries;
  const layoutRows = reconstructPrintedLayoutRows(evidence);
  if (layoutRows.length === 0) return entries;
  const identity = (sourceTitle: string): string => {
    const printed = printedPageEvidence(sourceTitle);
    const semanticTitle = printed?.title ?? sourceTitle;
    const numbering = inferPrintedHeadingEvidence(semanticTitle);
    return [
      numbering?.key ?? "",
      normalizedTitle(sourceTitle),
      printed?.pageLabel ?? "",
    ].join("\u0000");
  };
  const entryIdentities = new Set(
    entries.map((entry) => identity(entry.sourceTitle)),
  );
  const identitiesByPageIndex = new Map<number, Set<string>>();
  for (const row of layoutRows) {
    const key = identity(row.text);
    if (!entryIdentities.has(key)) continue;
    const identities = identitiesByPageIndex.get(row.pageIndex) ?? new Set();
    identities.add(key);
    identitiesByPageIndex.set(row.pageIndex, identities);
  }
  const pageClusters = [...identitiesByPageIndex.keys()]
    .sort((left, right) => left - right)
    .reduce<number[][]>((clusters, pageIndex) => {
      const current = clusters.at(-1);
      if (current && pageIndex === (current.at(-1) ?? -2) + 1) {
        current.push(pageIndex);
      } else {
        clusters.push([pageIndex]);
      }
      return clusters;
    }, [])
    .sort((left, right) => {
      const score = (cluster: readonly number[]): number =>
        cluster.reduce(
          (total, pageIndex) =>
            total + (identitiesByPageIndex.get(pageIndex)?.size ?? 0),
          0,
        );
      return score(right) - score(left) || (left[0] ?? 0) - (right[0] ?? 0);
    });
  const reliablePageIndexes = new Set(pageClusters[0] ?? []);
  const pageIndexesByIdentity = new Map<string, Set<number>>();
  for (const row of layoutRows) {
    if (!reliablePageIndexes.has(row.pageIndex)) continue;
    const key = identity(row.text);
    if (!entryIdentities.has(key)) continue;
    const pages = pageIndexesByIdentity.get(key) ?? new Set();
    pages.add(row.pageIndex);
    pageIndexesByIdentity.set(key, pages);
  }
  return Object.freeze(
    entries.map((entry) => {
      if (entry.pageIndex !== undefined) return entry;
      const pages = pageIndexesByIdentity.get(identity(entry.sourceTitle));
      const pageIndex = pages?.size === 1 ? [...pages][0] : undefined;
      return pageIndex === undefined
        ? entry
        : Object.freeze({ ...entry, pageIndex });
    }),
  );
}

function printedPageLabelInversions(
  entries: readonly Pick<ExtractedEntry, "sourceTitle">[],
): number {
  let inversions = 0;
  let previous: number | undefined;
  for (const entry of entries) {
    const page = printedPageEvidence(entry.sourceTitle)?.pageLabel;
    if (!page || !/^\d+$/u.test(page)) continue;
    const current = Number(page);
    if (previous !== undefined && current < previous) inversions += 1;
    previous = current;
  }
  return inversions;
}

function hasSemanticPageLabelRestart(
  entries: readonly ExtractedEntry[],
): boolean {
  let previousIndex: number | undefined;
  let previousPage: number | undefined;
  for (const [index, entry] of entries.entries()) {
    const label = printedPageEvidence(entry.sourceTitle)?.pageLabel;
    if (!label || !/^\d+$/u.test(label)) continue;
    const page = Number(label);
    if (
      previousIndex !== undefined &&
      previousPage !== undefined &&
      page < previousPage &&
      entries
        .slice(previousIndex + 1, index + 1)
        .some(
          (candidate) =>
            candidate.numbering?.kind === "appendix" ||
            /(?:\bappend(?:ix|ices)\b|附录)/iu.test(
              printedPageEvidence(candidate.sourceTitle)?.title ??
                candidate.sourceTitle,
            ),
        )
    ) {
      return true;
    }
    previousIndex = index;
    previousPage = page;
  }
  return false;
}

function reorderFromMonotonicPageLabels(
  entries: readonly ExtractedEntry[],
): readonly ExtractedEntry[] {
  if (
    entries.length < 20 ||
    printedPageLabelInversions(entries) === 0 ||
    hasSemanticPageLabelRestart(entries)
  ) {
    return entries;
  }
  const pages = entries.map((entry) => {
    const label = printedPageEvidence(entry.sourceTitle)?.pageLabel;
    return label && /^\d+$/u.test(label) ? Number(label) : undefined;
  });
  if (
    pages.filter((page) => page !== undefined).length / entries.length <
    0.6
  ) {
    return entries;
  }
  const ranks = pages.map((page, index) => {
    if (page !== undefined) return page;
    let previousIndex = index - 1;
    while (previousIndex >= 0 && pages[previousIndex] === undefined) {
      previousIndex -= 1;
    }
    let nextIndex = index + 1;
    while (nextIndex < pages.length && pages[nextIndex] === undefined) {
      nextIndex += 1;
    }
    const previous = pages[previousIndex];
    const next = pages[nextIndex];
    if (entries[index]?.numbering?.kind === "part") {
      let nextMajorIndex = index + 1;
      while (
        nextMajorIndex < entries.length &&
        (pages[nextMajorIndex] === undefined ||
          !["appendix", "chapter", "part"].includes(
            entries[nextMajorIndex]?.numbering?.kind ?? "",
          ))
      ) {
        nextMajorIndex += 1;
      }
      const nextMajor = pages[nextMajorIndex];
      if (nextMajor !== undefined) {
        return nextMajor - (nextMajorIndex - index) / (entries.length + 1);
      }
    }
    if (previous !== undefined && next !== undefined && previous <= next) {
      return (
        previous +
        ((next - previous) * (index - previousIndex)) /
          (nextIndex - previousIndex)
      );
    }
    if (next !== undefined) {
      return next - (nextIndex - index) / (entries.length + 1);
    }
    if (previous !== undefined) {
      return previous + (index - previousIndex) / (entries.length + 1);
    }
    return index;
  });
  const reordered = Object.freeze(
    entries
      .map((entry, index) => ({ entry, index, rank: ranks[index] ?? index }))
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map(({ entry }) => entry),
  );
  return printedPageLabelInversions(reordered) === 0 ? reordered : entries;
}

function reorderMajorBeforeSamePageDescendants(
  entries: readonly ExtractedEntry[],
): readonly ExtractedEntry[] {
  const reordered = [...entries];
  for (let index = 1; index < reordered.length; index += 1) {
    const major = reordered[index];
    if (major?.numbering?.kind !== "chapter") continue;
    const majorPage = printedPageEvidence(major.sourceTitle)?.pageLabel;
    const majorOrdinal = numericMajorOrdinal(
      major.numbering,
      major.sourceTitle,
    );
    if (!majorPage || !majorOrdinal) continue;
    let insertionIndex = index;
    while (insertionIndex > 0) {
      const previous = reordered[insertionIndex - 1];
      const previousPage = previous
        ? printedPageEvidence(previous.sourceTitle)?.pageLabel
        : undefined;
      const previousOrdinal = previous
        ? numericMajorOrdinal(previous.numbering, previous.sourceTitle)
        : undefined;
      if (
        previousPage !== majorPage ||
        previous?.numbering?.kind !== "decimal" ||
        previousOrdinal !== majorOrdinal
      ) {
        break;
      }
      insertionIndex -= 1;
    }
    if (insertionIndex === index) continue;
    reordered.splice(index, 1);
    reordered.splice(insertionIndex, 0, major);
  }
  return Object.freeze(reordered);
}

function reorderFromReliableLayout(
  entries: readonly ExtractedEntry[],
  layoutEntries: readonly Omit<ExtractedEntry, "range">[],
  similarityIndex: TextSimilarityIndex = createTextSimilarityIndex(),
): readonly ExtractedEntry[] {
  if (entries.length < 3 || layoutEntries.length < 3) return entries;
  const layoutByNumber = new Map<string, number[]>();
  const layoutByTitleAndPage = new Map<string, number[]>();
  const titleAndPageKey = (
    entry: Pick<ExtractedEntry, "normalizedTitle" | "sourceTitle">,
  ): string =>
    `${entry.normalizedTitle}\u0000${printedPageEvidence(entry.sourceTitle)?.pageLabel ?? ""}`;
  for (const [index, entry] of layoutEntries.entries()) {
    if (entry.numbering) {
      layoutByNumber.set(entry.numbering.key, [
        ...(layoutByNumber.get(entry.numbering.key) ?? []),
        index,
      ]);
    }
    const titleKey = titleAndPageKey(entry);
    layoutByTitleAndPage.set(titleKey, [
      ...(layoutByTitleAndPage.get(titleKey) ?? []),
      index,
    ]);
  }
  const layoutHeadings: readonly NormalizedHeading[] = layoutEntries.map(
    (entry, index) =>
      Object.freeze({
        blockId: `layout-order-${index}`,
        level: entry.referenceLevel,
        sourceTitle: entry.sourceTitle,
        textFingerprint: "",
      }),
  );
  const layoutHeadingFacts = layoutHeadings.map(createHeadingMatchFacts);
  const proposals = entries.flatMap((entry, sourceIndex) => {
    const candidates = new Set(
      entry.numbering ? (layoutByNumber.get(entry.numbering.key) ?? []) : [],
    );
    for (const index of layoutByTitleAndPage.get(titleAndPageKey(entry)) ??
      []) {
      candidates.add(index);
    }
    const ranked = [...candidates]
      .map((layoutIndex) => {
        const heading = layoutHeadings[layoutIndex];
        return {
          layoutIndex,
          score: heading
            ? matchScore(
                entry,
                heading,
                layoutHeadingFacts[layoutIndex] ??
                  createHeadingMatchFacts(heading),
                similarityIndex,
                true,
              )
            : 0,
          sourceIndex,
        };
      })
      .filter((candidate) => candidate.score >= 6)
      .sort(
        (left, right) =>
          right.score - left.score || left.layoutIndex - right.layoutIndex,
      );
    const best = ranked[0];
    const second = ranked[1];
    return best && best.score - (second?.score ?? 0) >= 2 ? [best] : [];
  });
  const assignments = new Map<number, number>();
  const claimedLayout = new Set<number>();
  for (const proposal of proposals.sort(
    (left, right) =>
      right.score - left.score || left.sourceIndex - right.sourceIndex,
  )) {
    if (
      assignments.has(proposal.sourceIndex) ||
      claimedLayout.has(proposal.layoutIndex)
    ) {
      continue;
    }
    assignments.set(proposal.sourceIndex, proposal.layoutIndex);
    claimedLayout.add(proposal.layoutIndex);
  }
  if (assignments.size < 3) return entries;
  let previousLayoutIndex = -1;
  let hasInversion = false;
  for (let sourceIndex = 0; sourceIndex < entries.length; sourceIndex += 1) {
    const layoutIndex = assignments.get(sourceIndex);
    if (layoutIndex === undefined) continue;
    if (layoutIndex < previousLayoutIndex) hasInversion = true;
    previousLayoutIndex = layoutIndex;
  }
  if (!hasInversion) return entries;
  const rankFor = (sourceIndex: number): number => {
    const exact = assignments.get(sourceIndex);
    if (exact !== undefined) return exact;
    let previousSource = sourceIndex - 1;
    while (previousSource >= 0 && !assignments.has(previousSource)) {
      previousSource -= 1;
    }
    let nextSource = sourceIndex + 1;
    while (nextSource < entries.length && !assignments.has(nextSource)) {
      nextSource += 1;
    }
    const previous = assignments.get(previousSource);
    const next = assignments.get(nextSource);
    if (previous !== undefined && next !== undefined && previous < next) {
      return (
        previous +
        ((next - previous) * (sourceIndex - previousSource)) /
          (nextSource - previousSource)
      );
    }
    if (previous !== undefined) {
      return previous + (sourceIndex - previousSource) / (entries.length + 1);
    }
    if (next !== undefined) {
      return next - (nextSource - sourceIndex) / (entries.length + 1);
    }
    return sourceIndex;
  };
  const reordered = Object.freeze(
    entries
      .map((entry, sourceIndex) => ({
        entry,
        rank: rankFor(sourceIndex),
        sourceIndex,
      }))
      .sort(
        (left, right) =>
          left.rank - right.rank || left.sourceIndex - right.sourceIndex,
      )
      .map(({ entry }) => entry),
  );
  const sourceInversions = printedPageLabelInversions(entries);
  const reorderedInversions = printedPageLabelInversions(reordered);
  return sourceInversions > 0 && reorderedInversions === 0
    ? reordered
    : entries;
}

export function hasReliableLayoutOrderInversion(
  sourceEvidence: LayoutEvidence,
  nativePdfEvidence: LayoutEvidence,
): boolean {
  if (nativePdfEvidence.source !== "native-pdf") return false;
  const sourceEntries: readonly ExtractedEntry[] = layoutLogicalEntries(
    sourceEvidence,
  ).map((entry, index) =>
    Object.freeze({
      ...entry,
      range: Object.freeze({
        end_byte: index + 1,
        sha256: "",
        start_byte: index,
      }),
    }),
  );
  const nativeEntries = layoutLogicalEntries(nativePdfEvidence);
  const reordered = reorderFromReliableLayout(sourceEntries, nativeEntries);
  const sourceInversions = printedPageLabelInversions(sourceEntries);
  const reorderedInversions = printedPageLabelInversions(reordered);
  if (
    sourceInversions === 0 ||
    reorderedInversions !== 0 ||
    reorderedInversions >= sourceInversions
  ) {
    return false;
  }
  return reordered.some((entry, index) => entry !== sourceEntries[index]);
}

export function shouldPreferNativePdfLayout(
  sourceEvidence: LayoutEvidence,
  nativePdfEvidence: LayoutEvidence,
): boolean {
  return hasReliableLayoutOrderInversion(sourceEvidence, nativePdfEvidence);
}

export function shouldPreferNativePdfDetection(
  sourceDetection: PrintedContentsDetection,
  nativeDetection: PrintedContentsDetection,
): boolean {
  const sourceCandidates = sourceDetection.candidates.filter(
    (candidate) => candidate.proposedRegion !== undefined,
  );
  const nativeCandidates = nativeDetection.candidates.filter(
    (candidate) =>
      candidate.proposedRegion !== undefined &&
      candidate.boundaryConfidence === "high",
  );
  if (
    nativeCandidates.length < 1 ||
    nativeCandidates.length !== sourceCandidates.length
  ) {
    return false;
  }
  const sourceEntries = sourceCandidates.reduce(
    (sum, candidate) => sum + candidate.entryCount,
    0,
  );
  const nativeEntries = nativeCandidates.reduce(
    (sum, candidate) => sum + candidate.entryCount,
    0,
  );
  const pageLabelInversions = (
    candidates: readonly PrintedContentsCandidate[],
  ): number =>
    candidates.reduce(
      (total, candidate) =>
        total + printedPageLabelInversions(candidate.logicalEntries ?? []),
      0,
    );
  const sourceInversions = pageLabelInversions(sourceCandidates);
  const nativeInversions = pageLabelInversions(nativeCandidates);
  if (nativeInversions > sourceInversions) return false;
  if (nativeInversions < sourceInversions) return true;
  const significantAdvantage = 3;
  if (nativeEntries >= sourceEntries + significantAdvantage) return true;
  const unresolvedPageLabels = (
    candidates: readonly PrintedContentsCandidate[],
  ): number =>
    candidates.reduce(
      (total, candidate) =>
        total +
        (candidate.logicalEntries ?? []).filter(
          (entry) =>
            printedPageEvidence(entry.sourceTitle) === undefined &&
            new RegExp(`${dotLeader.source}\\s*$`, "iu").test(
              plainTitle(entry.sourceTitle),
            ),
        ).length,
      0,
    );
  const sourceUnresolved = unresolvedPageLabels(sourceCandidates);
  const nativeUnresolved = unresolvedPageLabels(nativeCandidates);
  return (
    nativeEntries >= sourceEntries && sourceUnresolved - nativeUnresolved >= 3
  );
}

export function shouldUseNativePdfDetection(input: {
  readonly nativeDetection: PrintedContentsDetection;
  readonly nativeLayout: LayoutEvidence;
  readonly sourceDetection: PrintedContentsDetection;
  readonly sourceLayout: LayoutEvidence;
}): boolean {
  const nativeCandidates = input.nativeDetection.candidates.filter(
    (candidate) =>
      candidate.proposedRegion !== undefined &&
      candidate.boundaryConfidence === "high",
  );
  if (input.sourceLayout.source === "none") {
    return nativeCandidates.length > 0;
  }
  const sourceCandidates = input.sourceDetection.candidates.filter(
    (candidate) => candidate.proposedRegion !== undefined,
  );
  if (
    nativeCandidates.length < 1 ||
    nativeCandidates.length !== sourceCandidates.length
  ) {
    return false;
  }
  const inversions = (
    candidates: readonly PrintedContentsCandidate[],
  ): number =>
    candidates.reduce(
      (total, candidate) =>
        total + printedPageLabelInversions(candidate.logicalEntries ?? []),
      0,
    );
  if (inversions(nativeCandidates) > inversions(sourceCandidates)) return false;
  return (
    shouldPreferNativePdfLayout(input.sourceLayout, input.nativeLayout) ||
    shouldPreferNativePdfDetection(input.sourceDetection, input.nativeDetection)
  );
}

function recoverLayoutLogicalEntries(
  sourceEntries: readonly ExtractedEntry[],
  evidence: LayoutEvidence | undefined,
  similarityIndex: TextSimilarityIndex,
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
  const layoutHeadingFacts = layoutHeadings.map(createHeadingMatchFacts);
  const sourceContainsLayoutEntry = (
    layoutEntry: Omit<ExtractedEntry, "range">,
  ): boolean => {
    const layoutPage = printedPageEvidence(layoutEntry.sourceTitle)?.pageLabel;
    return sourceEntries.some((sourceEntry) => {
      if (
        layoutEntry.numbering &&
        sourceEntry.numbering?.key === layoutEntry.numbering.key &&
        similarity(
          sourceEntry.normalizedTitle,
          layoutEntry.normalizedTitle,
          similarityIndex,
        ) >= 0.55
      ) {
        return true;
      }
      const sourcePage = printedPageEvidence(
        sourceEntry.sourceTitle,
      )?.pageLabel;
      if (
        sourcePage === layoutPage &&
        sourceEntry.numbering !== undefined &&
        layoutEntry.numbering === undefined &&
        layoutEntry.normalizedTitle.length >= 12 &&
        sourceEntry.normalizedTitle.length >=
          layoutEntry.normalizedTitle.length + 4 &&
        sourceEntry.normalizedTitle.endsWith(layoutEntry.normalizedTitle)
      ) {
        return true;
      }
      return (
        sourceEntry.normalizedTitle === layoutEntry.normalizedTitle &&
        sourcePage === layoutPage
      );
    });
  };
  const acceptsLayoutOnlyEntry = (
    entry: Omit<ExtractedEntry, "range">,
  ): boolean => {
    if (evidence?.source !== "native-pdf") return true;
    const printed = printedPageEvidence(entry.sourceTitle);
    const title = printed?.title ?? plainTitle(entry.sourceTitle);
    if (/^(?:this is page|printer\s*:)/iu.test(title)) return false;
    if (printed) return /\p{L}/u.test(title);
    return (
      frontmatterEntryTitle.test(title) ||
      topLevelBackmatterTitle.test(title) ||
      explicitMajorEntryPrefix.test(title)
    );
  };
  const alignment = monotonicMatches(
    sourceEntries,
    layoutHeadings,
    layoutHeadingFacts,
    similarityIndex,
    {
      allowNumberOnly: true,
      requireNumberingForNumberedEntries: true,
    },
  );
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
  const needsLayoutRepair = (entry: ExtractedEntry): boolean => {
    const title = plainTitle(entry.sourceTitle);
    const containsLeader = dotLeader.test(title);
    return (
      entry.sourceTitle.includes("�") ||
      (!entry.numbering &&
        entry.normalizedTitle.length < 3 &&
        containsLeader) ||
      (printedPageEvidence(entry.sourceTitle) === undefined &&
        new RegExp(`${dotLeader.source}\\s*$`, "iu").test(title))
    );
  };
  const samePrintedEntry = (
    sourceEntry: ExtractedEntry,
    layoutEntry: Omit<ExtractedEntry, "range">,
  ): boolean => {
    const sourcePage = printedPageEvidence(sourceEntry.sourceTitle)?.pageLabel;
    const layoutPage = printedPageEvidence(layoutEntry.sourceTitle)?.pageLabel;
    if (!sourcePage || !layoutPage || sourcePage !== layoutPage) return false;
    if (
      sourceEntry.numbering &&
      layoutEntry.numbering &&
      sourceEntry.numbering.key === layoutEntry.numbering.key
    ) {
      return true;
    }
    return sourceEntry.normalizedTitle === layoutEntry.normalizedTitle;
  };
  const prefersNativeVisibleMath = (
    sourceEntry: ExtractedEntry,
    layoutEntry: Omit<ExtractedEntry, "range">,
  ): boolean => {
    const hasMarkdownMathSyntax = (value: string): boolean =>
      /\$[^$\n]+\$|\\[A-Za-z]+(?:\s*\{|\b)/u.test(value);
    if (
      evidence?.source !== "native-pdf" ||
      !hasMarkdownMathSyntax(sourceEntry.sourceTitle) ||
      hasMarkdownMathSyntax(layoutEntry.sourceTitle)
    ) {
      return false;
    }
    return (
      sourceEntry.numbering !== undefined &&
      sourceEntry.numbering.key === layoutEntry.numbering?.key
    );
  };
  const nativeSupersetMatches = (
    sourceGap: readonly ExtractedEntry[],
    layoutGap: readonly Omit<ExtractedEntry, "range">[],
  ): ReadonlyMap<number, number> | undefined => {
    if (
      evidence?.source !== "native-pdf" ||
      sourceGap.length < 1 ||
      sourceGap.length > 8 ||
      layoutGap.length <= sourceGap.length ||
      layoutGap.length > sourceGap.length + 8
    ) {
      return;
    }
    const matches = new Map<number, number>();
    let layoutOffset = 0;
    for (const [sourceOffset, sourceEntry] of sourceGap.entries()) {
      let matchedOffset = -1;
      for (
        let candidateOffset = layoutOffset;
        candidateOffset < layoutGap.length;
        candidateOffset += 1
      ) {
        const layoutEntry = layoutGap[candidateOffset];
        if (layoutEntry && samePrintedEntry(sourceEntry, layoutEntry)) {
          matchedOffset = candidateOffset;
          break;
        }
      }
      if (matchedOffset < 0) return;
      matches.set(matchedOffset, sourceOffset);
      layoutOffset = matchedOffset + 1;
    }
    return matches;
  };
  for (const anchor of anchors) {
    const sourceGap = sourceEntries.slice(sourceCursor, anchor.sourceIndex);
    const layoutGap = layoutEntries.slice(layoutCursor, anchor.layoutIndex);
    const supersetMatches = nativeSupersetMatches(sourceGap, layoutGap);
    const parallelNativeMatches =
      evidence?.source === "native-pdf" &&
      sourceGap.length > 0 &&
      sourceGap.length === layoutGap.length &&
      sourceGap.every((sourceEntry, offset) => {
        const layoutEntry = layoutGap[offset];
        return (
          layoutEntry !== undefined &&
          samePrintedEntry(sourceEntry, layoutEntry)
        );
      });
    const damagedSourceGap = sourceGap.some(needsLayoutRepair);
    const maximumEmptyLayoutGap =
      evidence?.source === "native-pdf" || evidence?.source === "ocr" ? 8 : 2;
    const fillsEmptyGap =
      sourceGap.length === 0 && layoutGap.length <= maximumEmptyLayoutGap;
    const replacesDamagedGap =
      damagedSourceGap &&
      sourceGap.length <= 2 &&
      layoutGap.length >= sourceGap.length &&
      layoutGap.length <= sourceGap.length + 8;
    if (supersetMatches) {
      for (const [offset, layoutEntry] of layoutGap.entries()) {
        const sourceOffset = supersetMatches.get(offset);
        if (sourceOffset === undefined) {
          if (sourceContainsLayoutEntry(layoutEntry)) continue;
          if (!acceptsLayoutOnlyEntry(layoutEntry)) continue;
          const sourceEntry =
            sourceEntries[nearestSourceIndex(layoutCursor + offset)];
          if (!sourceEntry) {
            throw new Error("PRINTED_TOC_LAYOUT_PROVENANCE_MISSING");
          }
          recovered.push(
            Object.freeze({
              ...layoutEntry,
              layoutOnly: true,
              range: sourceEntry.range,
            }),
          );
          continue;
        }
        const sourceEntry = sourceGap[sourceOffset];
        if (!sourceEntry) {
          throw new Error("PRINTED_TOC_LAYOUT_PROVENANCE_MISSING");
        }
        recovered.push(
          needsLayoutRepair(sourceEntry) ||
            sourceEntry.sourceTitle.includes("�") ||
            prefersNativeVisibleMath(sourceEntry, layoutEntry)
            ? Object.freeze({ ...layoutEntry, range: sourceEntry.range })
            : Object.freeze({
                ...sourceEntry,
                ...(layoutEntry.pageIndex === undefined
                  ? {}
                  : { pageIndex: layoutEntry.pageIndex }),
                sourceTitle: plainTitle(sourceEntry.sourceTitle),
              }),
        );
      }
    } else if (parallelNativeMatches) {
      recovered.push(
        ...sourceGap.map((sourceEntry, offset) => {
          const layoutEntry = layoutGap[offset];
          if (!layoutEntry) {
            throw new Error("PRINTED_TOC_LAYOUT_PROVENANCE_MISSING");
          }
          return prefersNativeVisibleMath(sourceEntry, layoutEntry)
            ? Object.freeze({ ...layoutEntry, range: sourceEntry.range })
            : sourceEntry;
        }),
      );
    } else if (layoutGap.length > 0 && replacesDamagedGap) {
      if (sourceGap.every(needsLayoutRepair)) {
        const acceptedLayoutGap = layoutGap.filter((entry, offset) => {
          const sourceEntry = sourceGap[Math.min(offset, sourceGap.length - 1)];
          return !sourceEntry?.numbering || entry.numbering !== undefined;
        });
        if (acceptedLayoutGap.length === 0) {
          recovered.push(...sourceGap);
        } else {
          recovered.push(
            ...acceptedLayoutGap.map((entry, offset) => {
              const sourceEntry =
                sourceEntries[nearestSourceIndex(layoutCursor + offset)];
              if (!sourceEntry) {
                throw new Error("PRINTED_TOC_LAYOUT_PROVENANCE_MISSING");
              }
              return Object.freeze({ ...entry, range: sourceEntry.range });
            }),
          );
        }
      } else if (layoutGap.length !== sourceGap.length) {
        recovered.push(...sourceGap);
      } else {
        recovered.push(
          ...sourceGap.map((sourceEntry, offset) => {
            const layoutEntry = layoutGap[offset];
            if (
              !layoutEntry ||
              !needsLayoutRepair(sourceEntry) ||
              (sourceEntry.numbering && !layoutEntry.numbering)
            ) {
              return sourceEntry;
            }
            return Object.freeze({
              ...layoutEntry,
              range: sourceEntry.range,
            });
          }),
        );
      }
    } else if (layoutGap.length > 0 && fillsEmptyGap) {
      const acceptedLayoutGap = layoutGap
        .map((entry, offset) => ({ entry, offset }))
        .filter(({ entry }) => {
          if (sourceContainsLayoutEntry(entry)) return false;
          if (!acceptsLayoutOnlyEntry(entry)) return false;
          const title =
            printedPageEvidence(entry.sourceTitle)?.title ??
            plainTitle(entry.sourceTitle);
          const numbering = inferPrintedHeadingEvidence(title);
          if (evidence?.source === "native-pdf") return true;
          if (evidence?.source === "ocr") {
            return (
              entry.referenceLevel > 1 ||
              numbering !== undefined ||
              frontmatterEntryTitle.test(title) ||
              topLevelBackmatterTitle.test(title)
            );
          }
          return (
            (numbering !== undefined ||
              frontmatterEntryTitle.test(title) ||
              topLevelBackmatterTitle.test(title)) &&
            !contextualEntryTitle.test(title)
          );
        });
      if (acceptedLayoutGap.length === 0) {
        recovered.push(...sourceGap);
      } else {
        recovered.push(
          ...acceptedLayoutGap.map(({ entry, offset }) => {
            const sourceEntry =
              sourceEntries[nearestSourceIndex(layoutCursor + offset)];
            if (!sourceEntry) {
              throw new Error("PRINTED_TOC_LAYOUT_PROVENANCE_MISSING");
            }
            return Object.freeze({
              ...entry,
              layoutOnly: true,
              range: sourceEntry.range,
            });
          }),
        );
      }
    } else {
      recovered.push(...sourceGap);
    }
    const sourceEntry = sourceEntries[anchor.sourceIndex];
    const layoutEntry = layoutEntries[anchor.layoutIndex];
    if (!sourceEntry || !layoutEntry) {
      throw new Error("PRINTED_TOC_LAYOUT_PROVENANCE_MISSING");
    }
    const sourceAnchorDamaged = needsLayoutRepair(sourceEntry);
    const sourcePrinted = printedPageEvidence(sourceEntry.sourceTitle);
    const layoutPrinted = printedPageEvidence(layoutEntry.sourceTitle);
    const layoutHasMissingPage =
      sourcePrinted === undefined &&
      layoutPrinted !== undefined &&
      (new RegExp(`${dotLeader.source}\\s*$`, "iu").test(
        plainTitle(sourceEntry.sourceTitle),
      ) ||
        (evidence?.source === "content-list" &&
          similarity(
            sourceEntry.normalizedTitle,
            normalizedTitle(layoutPrinted.title),
            similarityIndex,
          ) >= 0.9));
    recovered.push(
      sourceAnchorDamaged ||
        layoutHasMissingPage ||
        prefersNativeVisibleMath(sourceEntry, layoutEntry)
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
  const reordered = reorderFromMonotonicPageLabels(
    reorderFromReliableLayout(recovered, layoutEntries, similarityIndex),
  );
  const semanticallyOrdered = reorderMajorBeforeSamePageDescendants(reordered);
  if (evidence?.source !== "native-pdf") return semanticallyOrdered;
  return Object.freeze(
    semanticallyOrdered.map((entry) => {
      const nativeMatches = layoutEntries.filter((layoutEntry) =>
        prefersNativeVisibleMath(entry, layoutEntry),
      );
      const nativeMatch =
        nativeMatches.length === 1 ? nativeMatches[0] : undefined;
      return nativeMatch
        ? Object.freeze({ ...nativeMatch, range: entry.range })
        : entry;
    }),
  );
}

interface DetectPrintedContentsInput {
  readonly document: NormalizedDocument;
  readonly documentIndex?: PrintedContentsDocumentIndex;
  readonly idFactory?: () => string;
  readonly layoutEvidence?: LayoutEvidence;
  readonly sourcePath: string;
  readonly sourceSha256: string;
}

interface CandidateWindow {
  readonly endIndex: number;
  readonly explicit: boolean;
  readonly firstEntryIndex: number;
  readonly startIndex: number;
}

interface EstimatedCandidateWindow {
  readonly end: number;
  readonly start: number;
}

interface PrintedContentsDetectionContext {
  readonly contextualTitles: ReadonlySet<string>;
  readonly documentIndex: PrintedContentsDocumentIndex;
  readonly factsFor: (heading: NormalizedHeading) => HeadingMatchFacts;
  readonly input: DetectPrintedContentsInput;
  readonly layoutLevelByTitle: ReadonlyMap<string, readonly number[]>;
  readonly roots: readonly TransientDocumentNode[];
  readonly similarityIndex: TextSimilarityIndex;
  readonly sourceBytes: Buffer;
  readonly sourceIndex: SourceTextIndex;
  readonly titleOf: (node: TransientDocumentNode) => string;
}

function createPrintedContentsDetectionContext(
  input: DetectPrintedContentsInput,
): PrintedContentsDetectionContext {
  const documentIndex =
    input.documentIndex ?? createPrintedContentsDocumentIndex(input.document);
  if (
    documentIndex.document !== input.document ||
    documentIndex.sourceSha256 !== input.sourceSha256
  ) {
    throw new Error("PRINTED_TOC_SOURCE_HASH_MISMATCH");
  }
  return Object.freeze({
    contextualTitles: repairableContextualTitles(input.layoutEvidence),
    documentIndex,
    factsFor: (heading: NormalizedHeading): HeadingMatchFacts =>
      documentIndex.headingFactsByBlockId.get(heading.blockId) ??
      createHeadingMatchFacts(heading),
    input,
    layoutLevelByTitle: layoutLevels(input.layoutEvidence),
    roots: input.document.root.children ?? [],
    similarityIndex: createTextSimilarityIndex(),
    sourceBytes: documentIndex.sourceBytes,
    sourceIndex: documentIndex.sourceIndex,
    titleOf: (node: TransientDocumentNode): string =>
      documentIndex.rootTitleByNode.get(node) ?? rootTitle(node),
  });
}

function discoverCandidateWindows(
  context: PrintedContentsDetectionContext,
): readonly CandidateWindow[] {
  const { input, roots, sourceBytes, sourceIndex, titleOf } = context;
  const ranges: CandidateWindow[] = [];
  const explicitLabels = roots.flatMap((root, index) =>
    contentsTitle.test(titleOf(root).normalize("NFKC")) ? [index] : [],
  );
  for (let labelIndex = 0; labelIndex < explicitLabels.length;) {
    const startIndex = explicitLabels[labelIndex];
    if (startIndex === undefined) break;
    let labelEndIndex = startIndex;
    while (explicitLabels[labelIndex + 1] === labelEndIndex + 1) {
      labelEndIndex = explicitLabels[++labelIndex] ?? labelEndIndex;
    }
    ranges.push(
      Object.freeze({
        endIndex: (explicitLabels[labelIndex + 1] ?? roots.length) - 1,
        explicit: true,
        firstEntryIndex: labelEndIndex + 1,
        startIndex,
      }),
    );
    labelIndex += 1;
  }
  if (ranges.length > 0) return Object.freeze(ranges);
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
      sourceIndex,
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
        sourceIndex,
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
      ranges.push(
        Object.freeze({
          endIndex: roots.length - 1,
          explicit: false,
          firstEntryIndex: index,
          startIndex: index,
        }),
      );
      break;
    }
  }
  return Object.freeze(ranges);
}

function estimateCandidateWindows(
  context: PrintedContentsDetectionContext,
  ranges: readonly CandidateWindow[],
): readonly (EstimatedCandidateWindow | undefined)[] {
  const { contextualTitles, input, roots, sourceBytes, sourceIndex, titleOf } =
    context;
  return Object.freeze(
    ranges.map((range) => {
      const seenTitles = new Set<string>();
      let endIndex: number | undefined;
      for (
        let index = range.firstEntryIndex;
        index <= range.endIndex;
        index += 1
      ) {
        const block = roots[index];
        if (!block?.position) continue;
        if (
          index > range.firstEntryIndex &&
          contentsTitle.test(titleOf(block).normalize("NFKC"))
        ) {
          endIndex = index - 1;
          break;
        }
        const title =
          block.type === "heading" ? normalizedTitle(titleOf(block)) : "";
        const printedRowsContinue = roots
          .slice(index + 1, index + 5)
          .some((candidate) =>
            hasPrintedPageLine(candidate, input.document.source),
          );
        if (
          title &&
          seenTitles.has(title) &&
          printedPageEvidence(titleOf(block)) === undefined &&
          !printedRowsContinue
        ) {
          endIndex = index - 1;
          break;
        }
        for (const entry of lineEntries({
          block,
          previousLevel: 0,
          repairableContextualTitles: contextualTitles,
          source: input.document.source,
          sourceBytes,
          sourceIndex,
        })) {
          if (entry.normalizedTitle) seenTitles.add(entry.normalizedTitle);
        }
      }
      const start = roots[range.startIndex]?.position?.start.offset;
      const end =
        endIndex === undefined
          ? undefined
          : roots[endIndex]?.position?.end.offset;
      return start === undefined || end === undefined
        ? undefined
        : Object.freeze({ end, start });
    }),
  );
}

interface ParsedCandidateRegion {
  readonly candidateEndIndex: number;
  readonly requiresPdfEvidence: boolean;
  readonly richContent: boolean;
  readonly sourceEntries: readonly ExtractedEntry[];
  readonly window: CandidateWindow;
}

interface RecoveredCandidateRegion extends Omit<
  ParsedCandidateRegion,
  "sourceEntries"
> {
  readonly entries: readonly ExtractedEntry[];
}

function parseCandidateRegion(
  context: PrintedContentsDetectionContext,
  window: CandidateWindow,
): ParsedCandidateRegion {
  const { contextualTitles, input, roots, sourceBytes, sourceIndex, titleOf } =
    context;
  const sourceEntries: ExtractedEntry[] = [];
  let candidateEndIndex = window.startIndex;
  let richContent = false;
  let noiseBlocks = 0;
  let requiresPdfEvidence = false;
  for (
    let index = window.firstEntryIndex;
    index <= window.endIndex;
    index += 1
  ) {
    const block = roots[index];
    if (!block?.position) continue;
    if (
      sourceEntries.length > 0 &&
      supplementalListTitle.test(titleOf(block).normalize("NFKC"))
    ) {
      break;
    }
    const possibleBodyTitle =
      block.type === "heading" ? normalizedTitle(titleOf(block)) : "";
    const printedRowsContinue = roots
      .slice(index + 1, index + 5)
      .some((candidate) =>
        hasPrintedPageLine(candidate, input.document.source),
      );
    const nextBlock = roots[index + 1];
    const nextBodyTitle =
      nextBlock?.type === "heading" ? normalizedTitle(titleOf(nextBlock)) : "";
    const currentNumbering = inferPrintedHeadingEvidence(titleOf(block));
    const currentKind = currentNumbering?.kind;
    if (
      sourceEntries.length > 0 &&
      !printedRowsContinue &&
      block.type === "heading" &&
      currentNumbering &&
      printedPageEvidence(titleOf(block)) === undefined &&
      sourceEntries.some(
        (entry) => entry.numbering?.key === currentNumbering.key,
      )
    ) {
      break;
    }
    if (
      sourceEntries.length > 0 &&
      !printedRowsContinue &&
      block.type === "heading" &&
      (currentKind === "part" || currentKind === "chapter") &&
      printedPageEvidence(titleOf(block)) === undefined &&
      standaloneMajorLabel.test(plainTitle(titleOf(block))) &&
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
      printedPageEvidence(titleOf(block)) === undefined &&
      !printedRowsContinue
    ) {
      break;
    }
    const extracted = lineEntries({
      block,
      previousLevel: sourceEntries.at(-1)?.referenceLevel ?? 0,
      repairableContextualTitles: contextualTitles,
      source: input.document.source,
      sourceBytes,
      sourceIndex,
    });
    const previousEntry = sourceEntries.at(-1);
    const detachedPartSubtitle =
      extracted.length === 0 &&
      block.type === "heading" &&
      previousEntry?.numbering?.kind === "part" &&
      printedPageEvidence(previousEntry.sourceTitle) === undefined &&
      currentNumbering === undefined &&
      possibleBodyTitle.length >= 2 &&
      possibleBodyTitle.length <= 80 &&
      !frontmatterEntryTitle.test(titleOf(block)) &&
      !contextualEntryTitle.test(titleOf(block)) &&
      roots.slice(index + 1, index + 5).some((candidate) => {
        const candidateTitle = titleOf(candidate);
        const candidateKind = inferPrintedHeadingEvidence(candidateTitle)?.kind;
        return (
          hasPrintedPageLine(candidate, input.document.source) ||
          candidateKind === "chapter"
        );
      });
    if (detachedPartSubtitle && previousEntry && block.position) {
      const sourceTitle = `${plainTitle(previousEntry.sourceTitle)} ${plainTitle(titleOf(block))}`;
      const endByte = sourceIndex.byteOffsetAt(block.position.end.offset);
      sourceEntries[sourceEntries.length - 1] = Object.freeze({
        ...previousEntry,
        normalizedTitle: normalizedTitle(sourceTitle),
        range: Object.freeze({
          end_byte: endByte,
          sha256: hash(
            sourceBytes.subarray(previousEntry.range.start_byte, endByte),
          ),
          start_byte: previousEntry.range.start_byte,
        }),
        sourceTitle,
      });
      candidateEndIndex = index;
      noiseBlocks = 0;
      continue;
    }
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
  return Object.freeze({
    candidateEndIndex,
    requiresPdfEvidence,
    richContent,
    sourceEntries: Object.freeze(sourceEntries),
    window,
  });
}

function recoverCandidateRegion(
  context: PrintedContentsDetectionContext,
  parsed: ParsedCandidateRegion,
  layoutOccurrences: Map<string, number>,
): RecoveredCandidateRegion {
  const { input, layoutLevelByTitle, similarityIndex, sourceBytes } = context;
  const entries = [
    ...attachReliableLayoutPageIndexes(
      recoverLayoutLogicalEntries(
        mergeDetachedSourceEntries(parsed.sourceEntries, sourceBytes),
        input.layoutEvidence,
        similarityIndex,
      ),
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
    const layoutLevelsForTitle = layoutLevelByTitle.get(entry.normalizedTitle);
    const layoutLevel =
      layoutLevelsForTitle?.[occurrence] ?? layoutLevelsForTitle?.at(-1);
    const semanticTitle =
      printedPageEvidence(entry.sourceTitle)?.title ??
      plainTitle(entry.sourceTitle);
    const semanticNumbering = inferPrintedHeadingEvidence(semanticTitle);
    const numbering = semanticNumbering ?? entry.numbering;
    const layoutSensitiveLocal = /^appendix\s*[:：]/iu.test(semanticTitle);
    const proposedLevel = layoutSensitiveLocal
      ? Math.max(
          inferredLevels[index] ?? entry.referenceLevel,
          layoutLevel ?? 0,
        )
      : numbering ||
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
    entries[index] = Object.freeze({
      ...entry,
      ...(numbering ? { numbering } : {}),
      referenceLevel,
    });
    previousResolvedLevel = referenceLevel;
  });
  return Object.freeze({
    candidateEndIndex: parsed.candidateEndIndex,
    entries: Object.freeze(entries),
    requiresPdfEvidence: parsed.requiresPdfEvidence,
    richContent: parsed.richContent,
    window: parsed.window,
  });
}

function recoverCandidateRegions(
  context: PrintedContentsDetectionContext,
  parsedRegions: readonly ParsedCandidateRegion[],
): readonly RecoveredCandidateRegion[] {
  const layoutOccurrences = new Map<string, number>();
  return Object.freeze(
    parsedRegions.map((parsed) =>
      recoverCandidateRegion(context, parsed, layoutOccurrences),
    ),
  );
}

interface CandidateHeadingIndex {
  readonly bodyHeadingFacts: readonly HeadingMatchFacts[];
  readonly bodyHeadings: readonly NormalizedHeading[];
  readonly laterHeadingFacts: readonly HeadingMatchFacts[];
  readonly laterHeadings: readonly NormalizedHeading[];
}

function indexCandidateHeadings(
  context: PrintedContentsDetectionContext,
  recovered: RecoveredCandidateRegion,
  rangeIndex: number,
  estimatedWindows: readonly (EstimatedCandidateWindow | undefined)[],
): CandidateHeadingIndex {
  const { factsFor, input, roots } = context;
  const candidateEndOffset =
    roots[recovered.candidateEndIndex]?.position?.end.offset ??
    Number.POSITIVE_INFINITY;
  const candidateStartOffset =
    roots[recovered.window.startIndex]?.position?.start.offset ??
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
    const insideOtherPrintedWindow = estimatedWindows.some(
      (window, windowIndex) =>
        windowIndex !== rangeIndex &&
        window !== undefined &&
        start >= window.start &&
        start <= window.end,
    );
    return (
      !insideOtherPrintedWindow &&
      (start < candidateStartOffset || start > candidateEndOffset) &&
      eligibleHeading(heading, start > candidateEndOffset)
    );
  });
  return Object.freeze({
    bodyHeadingFacts: Object.freeze(bodyHeadings.map(factsFor)),
    bodyHeadings: Object.freeze(bodyHeadings),
    laterHeadingFacts: Object.freeze(laterHeadings.map(factsFor)),
    laterHeadings: Object.freeze(laterHeadings),
  });
}

interface CandidateAlignment {
  readonly ambiguousEntries: ReadonlySet<number>;
  readonly matches: ReadonlyMap<number, number>;
  readonly score: ReturnType<typeof monotonicMatches>;
}

interface AlignedCandidateRegion {
  readonly alignment: ReturnType<typeof monotonicMatches>;
  readonly diagnostics: readonly PrintedContentsDiagnostic[];
  readonly entries: readonly AlignedEntry[];
}

function alignCandidateHeadings(
  context: PrintedContentsDetectionContext,
  recovered: RecoveredCandidateRegion,
  headingIndex: CandidateHeadingIndex,
): CandidateAlignment {
  const { similarityIndex } = context;
  const { entries } = recovered;
  const { bodyHeadingFacts, bodyHeadings } = headingIndex;
  const summaryCandidate =
    entries.filter(
      (entry) =>
        entry.numbering?.kind === "part" || entry.numbering?.kind === "chapter",
    ).length >= 3 &&
    entries.filter((entry) => entry.numbering?.kind === "decimal").length /
      Math.max(1, entries.length) <
      0.25;
  const score = monotonicMatches(
    entries,
    bodyHeadings,
    bodyHeadingFacts,
    similarityIndex,
    {
      allowMajorSectionFallback: summaryCandidate,
      allowNumberOnly: false,
    },
  );
  const resolvedMatches = new Map(score.matches);
  const ambiguousEntries = new Set(score.ambiguousEntries);
  const usedHeadingIndexes = new Set(resolvedMatches.values());
  for (const [entryIndex, entry] of entries.entries()) {
    const localAppendix =
      entry.numbering?.kind === "appendix" &&
      entry.numbering.key === "appendix";
    const pageOnlyReviewEntry =
      entry.normalizedTitle.length === 0 &&
      printedPageEvidence(entry.sourceTitle) !== undefined;
    const localUnnumberedRepair =
      entry.numbering === undefined &&
      (entry.normalizedTitle.length >= 2 || pageOnlyReviewEntry);
    if (
      resolvedMatches.has(entryIndex) ||
      (!localAppendix &&
        entry.numbering?.kind !== "part" &&
        entry.numbering?.kind !== "chapter" &&
        !entry.layoutOnly &&
        !localUnnumberedRepair)
    ) {
      continue;
    }
    let lowerBound = -1;
    let upperBound = bodyHeadings.length;
    for (const [matchedEntryIndex, matchedHeadingIndex] of resolvedMatches) {
      if (matchedEntryIndex < entryIndex && matchedHeadingIndex > lowerBound) {
        lowerBound = matchedHeadingIndex;
      } else if (
        matchedEntryIndex > entryIndex &&
        matchedHeadingIndex < upperBound
      ) {
        upperBound = matchedHeadingIndex;
      }
    }
    const candidates = bodyHeadings
      .map((heading, candidateHeadingIndex) => {
        const headingFacts =
          bodyHeadingFacts[candidateHeadingIndex] ??
          createHeadingMatchFacts(heading);
        const eligible =
          candidateHeadingIndex > lowerBound &&
          candidateHeadingIndex < upperBound &&
          !usedHeadingIndexes.has(candidateHeadingIndex);
        const exactScore = eligible
          ? matchScore(
              entry,
              heading,
              headingFacts,
              similarityIndex,
              entry.normalizedTitle.length < 2,
            )
          : 0;
        const fuzzyScore =
          eligible &&
          localUnnumberedRepair &&
          !entry.sourceTitle.includes("�") &&
          !heading.sourceTitle.includes("�")
            ? pageOnlyReviewEntry &&
              chapterReviewChildTitle.test(plainTitle(heading.sourceTitle))
              ? 8
              : characterSimilarity(
                  entry.normalizedTitle,
                  headingFacts.normalizedTitle,
                  similarityIndex,
                ) * 10
            : 0;
        return {
          headingIndex: candidateHeadingIndex,
          score: Math.max(exactScore, fuzzyScore >= 4.5 ? fuzzyScore : 0),
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.headingIndex - right.headingIndex,
      );
    const best = candidates[0];
    const second = candidates[1];
    const frontmatterRepair = frontmatterEntryTitle.test(
      printedPageEvidence(entry.sourceTitle)?.title ??
        plainTitle(entry.sourceTitle),
    );
    const minimumScore = localAppendix
      ? 6
      : frontmatterRepair
        ? 7.5
        : entry.layoutOnly || localUnnumberedRepair
          ? 4.5
          : 16;
    const minimumMargin = localAppendix
      ? 2
      : frontmatterRepair
        ? 2
        : entry.layoutOnly || localUnnumberedRepair
          ? 1.5
          : 4;
    if (
      best &&
      best.score >= minimumScore &&
      best.score - (second?.score ?? 0) >= minimumMargin
    ) {
      resolvedMatches.set(entryIndex, best.headingIndex);
      usedHeadingIndexes.add(best.headingIndex);
      ambiguousEntries.delete(entryIndex);
    }
  }
  return Object.freeze({
    ambiguousEntries,
    matches: resolvedMatches,
    score,
  });
}

function materializeAlignedCandidate(
  context: PrintedContentsDetectionContext,
  recovered: RecoveredCandidateRegion,
  headingIndex: CandidateHeadingIndex,
  candidateAlignment: CandidateAlignment,
  candidateIndex: number,
): AlignedCandidateRegion {
  const { similarityIndex } = context;
  const { entries } = recovered;
  const { bodyHeadingFacts, bodyHeadings } = headingIndex;
  const { ambiguousEntries, matches } = candidateAlignment;
  const diagnostics: PrintedContentsDiagnostic[] = [];
  let nextLogicalEntryIndex = 0;
  const recoveredTitleEntryIndexes = new Set<number>();
  let alignedEntries = entries.flatMap<AlignedEntry>((entry, entryIndex) => {
    if (ambiguousEntries.has(entryIndex)) {
      const logicalEntryIndex = nextLogicalEntryIndex++;
      diagnostics.push(
        diagnostic(
          "PRINTED_TOC_AMBIGUOUS_MATCH",
          `candidates/${candidateIndex}/entries/${logicalEntryIndex}`,
        ),
      );
      return [
        Object.freeze({
          ...entry,
          alignment: Object.freeze({ state: "ambiguous" as const }),
        }),
      ];
    }
    const matchedHeadingIndex = matches.get(entryIndex);
    const match =
      matchedHeadingIndex === undefined
        ? undefined
        : bodyHeadings[matchedHeadingIndex];
    const matchFacts =
      matchedHeadingIndex === undefined
        ? undefined
        : bodyHeadingFacts[matchedHeadingIndex];
    if (!match) {
      const logicalEntryIndex = nextLogicalEntryIndex++;
      diagnostics.push(
        diagnostic(
          "PRINTED_TOC_UNMATCHED_ENTRY",
          `candidates/${candidateIndex}/entries/${logicalEntryIndex}`,
        ),
      );
      return [
        Object.freeze({
          ...entry,
          alignment: Object.freeze({ state: "unmatched" as const }),
        }),
      ];
    }
    const logicalEntryIndex = nextLogicalEntryIndex++;
    const sourceTitle = recoveredMatchedSourceTitle(
      entry,
      matchFacts ?? createHeadingMatchFacts(match),
      hasSupportedOmittedDecimalNumber(
        entries,
        entryIndex,
        matchFacts ?? createHeadingMatchFacts(match),
      ) ||
        contextualEntryTitle.test(
          printedPageEvidence(entry.sourceTitle)?.title ??
            plainTitle(entry.sourceTitle),
        ),
      similarityIndex,
    );
    if (sourceTitle !== entry.sourceTitle) {
      recoveredTitleEntryIndexes.add(logicalEntryIndex);
    }
    return [
      Object.freeze({
        ...entry,
        alignment: Object.freeze({
          bodyHeadingBlockId: match.blockId,
          state: "matched" as const,
        }),
        normalizedTitle: normalizedTitle(sourceTitle),
        sourceTitle,
      }),
    ];
  });
  const recoveredLevels = inferPrintedReferenceLevels(
    alignedEntries.map((entry) => entry.sourceTitle),
  );
  const hasExplicitMajorContext = alignedEntries.some(
    (entry) =>
      entry.numbering?.kind === "part" || entry.numbering?.kind === "chapter",
  );
  alignedEntries = alignedEntries.map((entry, index) => {
    const recoveredNumbering = inferPrintedHeadingEvidence(
      printedPageEvidence(entry.sourceTitle)?.title ?? entry.sourceTitle,
    );
    const recoveredLevel = recoveredLevels[index] ?? entry.referenceLevel;
    const numberingChanged = entry.numbering?.key !== recoveredNumbering?.key;
    const contextualNumbering =
      recoveredNumbering?.kind === "appendix" ||
      recoveredNumbering?.kind === "chapter" ||
      recoveredNumbering?.kind === "decimal";
    const levelNeedsContext =
      hasExplicitMajorContext &&
      contextualNumbering &&
      entry.referenceLevel !== recoveredLevel;
    if (
      !recoveredNumbering ||
      (!numberingChanged &&
        !levelNeedsContext &&
        (!recoveredTitleEntryIndexes.has(index) ||
          entry.referenceLevel === recoveredLevel))
    ) {
      return entry;
    }
    return Object.freeze({
      ...entry,
      numbering: recoveredNumbering,
      referenceLevel: recoveredLevel,
    });
  });
  const nearestMatchedBlock = (entryIndex: number): string | undefined => {
    for (let distance = 1; distance < alignedEntries.length; distance += 1) {
      const before = alignedEntries[entryIndex - distance];
      const beforeBlockId = before
        ? alignedBodyHeadingBlockId(before)
        : undefined;
      if (beforeBlockId) return beforeBlockId;
      const after = alignedEntries[entryIndex + distance];
      const afterBlockId = after ? alignedBodyHeadingBlockId(after) : undefined;
      if (afterBlockId) return afterBlockId;
    }
    return undefined;
  };
  for (let index = 0; index < diagnostics.length; index += 1) {
    const item = diagnostics[index];
    const entryIndex = Number(/\/entries\/(\d+)$/u.exec(item?.path ?? "")?.[1]);
    if (item && Number.isSafeInteger(entryIndex) && !item.blockId) {
      diagnostics[index] = diagnostic(
        item.code,
        item.path,
        nearestMatchedBlock(entryIndex),
      );
    }
  }
  return Object.freeze({
    alignment: candidateAlignment.score,
    diagnostics: Object.freeze(diagnostics),
    entries: Object.freeze(alignedEntries),
  });
}

interface CandidateRegionDecision {
  readonly boundaryConfidence: PrintedContentsCandidate["boundaryConfidence"];
  readonly canApplyBoundary: boolean;
  readonly diagnostics: readonly PrintedContentsDiagnostic[];
  readonly endByte: number;
  readonly matchConfidence: PrintedContentsCandidate["matchConfidence"];
  readonly matchedCount: number;
  readonly startByte: number;
}

function evaluateCandidateRegion(
  context: PrintedContentsDetectionContext,
  recovered: RecoveredCandidateRegion,
  headingIndex: CandidateHeadingIndex,
  aligned: AlignedCandidateRegion,
  candidateIndex: number,
): CandidateRegionDecision | undefined {
  const { roots, similarityIndex, sourceIndex } = context;
  const { candidateEndIndex, richContent, window } = recovered;
  const { laterHeadingFacts, laterHeadings } = headingIndex;
  const { alignment, entries, diagnostics: alignmentDiagnostics } = aligned;
  const diagnostics = [...alignmentDiagnostics];
  if (entries.length < 3) {
    diagnostics.push(
      diagnostic(
        "PRINTED_TOC_INSUFFICIENT_ENTRIES",
        `candidates/${candidateIndex}`,
      ),
    );
  }
  let previousLevel = 0;
  if (
    entries.some((entry) => {
      const skipped =
        previousLevel === 0
          ? entry.referenceLevel !== 1
          : entry.referenceLevel > previousLevel + 1;
      previousLevel = entry.referenceLevel;
      return skipped;
    })
  ) {
    diagnostics.push(
      diagnostic("PRINTED_TOC_LEVEL_GAP", `candidates/${candidateIndex}`),
    );
  }
  const matchedCount = entries.filter(
    (entry) => entry.alignment.state === "matched",
  ).length;
  const coverage = entries.length === 0 ? 0 : matchedCount / entries.length;
  if (coverage < 0.6) {
    diagnostics.push(
      diagnostic("PRINTED_TOC_LOW_COVERAGE", `candidates/${candidateIndex}`),
    );
  }
  const firstNode = roots[window.startIndex];
  const candidateEnd = roots[candidateEndIndex] ?? firstNode;
  if (!firstNode?.position || !candidateEnd?.position) return;
  const startByte = sourceIndex.byteOffsetAt(firstNode.position.start.offset);
  const endByte = sourceIndex.byteOffsetAt(candidateEnd.position.end.offset);
  const recurrenceCount = entries.filter((entry) =>
    laterHeadings.some(
      (heading, laterHeadingIndex) =>
        matchScore(
          entry,
          heading,
          laterHeadingFacts[laterHeadingIndex] ??
            createHeadingMatchFacts(heading),
          similarityIndex,
        ) > 0,
    ),
  ).length;
  const recurrenceCoverage =
    entries.length === 0 ? 0 : recurrenceCount / entries.length;
  const boundaryEvidenceCount = entries.filter(
    (entry) =>
      entry.numbering !== undefined ||
      printedPageEvidence(entry.sourceTitle) !== undefined ||
      dotLeader.test(entry.sourceTitle),
  ).length;
  const frontmatter = window.startIndex / Math.max(1, roots.length) <= 0.5;
  let boundaryScore = window.explicit ? 2 : 0;
  boundaryScore += entries.length >= 3 ? 2 : entries.length >= 2 ? 1 : 0;
  boundaryScore +=
    boundaryEvidenceCount >= Math.min(2, entries.length) && entries.length > 0
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
      diagnostic("PRINTED_TOC_RICH_CONTENT", `candidates/${candidateIndex}`),
    );
  }
  const matchConfidence =
    coverage >= 0.8 && alignment.margin >= 2
      ? "high"
      : coverage >= 0.5
        ? "medium"
        : "low";
  return Object.freeze({
    boundaryConfidence,
    canApplyBoundary: boundaryConfidence === "high" && entries.length >= 2,
    diagnostics: Object.freeze(diagnostics),
    endByte,
    matchConfidence,
    matchedCount,
    startByte,
  });
}

function materializeCandidateRegion(
  context: PrintedContentsDetectionContext,
  recovered: RecoveredCandidateRegion,
  aligned: AlignedCandidateRegion,
  decision: CandidateRegionDecision,
): PrintedContentsCandidate {
  const { documentIndex, input, sourceBytes } = context;
  const { requiresPdfEvidence } = recovered;
  const { alignment, entries } = aligned;
  const {
    boundaryConfidence,
    canApplyBoundary,
    diagnostics,
    endByte,
    matchConfidence,
    matchedCount,
    startByte,
  } = decision;
  const sourceRegionEntries = entries
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
  let previousSourceRegionHeadingIndex = -1;
  const sourceRegionHeadingIndexes = documentIndex.sourceRegionHeadingIndexes;
  const proposedRegion = canApplyBoundary
    ? Object.freeze({
        applied: true,
        disposition: "reference_only" as const,
        entries: Object.freeze(
          sourceRegionEntries.map((entry) => {
            const bodyHeadingBlockId = alignedBodyHeadingBlockId(entry);
            const matchedHeadingIndex = bodyHeadingBlockId
              ? sourceRegionHeadingIndexes.get(bodyHeadingBlockId)
              : undefined;
            const retainsMatch =
              matchedHeadingIndex !== undefined &&
              matchedHeadingIndex > previousSourceRegionHeadingIndex;
            if (retainsMatch) {
              previousSourceRegionHeadingIndex = matchedHeadingIndex;
            }
            return Object.freeze({
              ...(retainsMatch && bodyHeadingBlockId
                ? { body_heading_block_id: bodyHeadingBlockId }
                : {}),
              range: entry.range,
              reference_level: entry.referenceLevel,
            });
          }),
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
  return Object.freeze({
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
    entryCount: entries.length,
    logicalEntries: Object.freeze(
      entries.map((entry) => {
        const bodyHeadingBlockId = alignedBodyHeadingBlockId(entry);
        return Object.freeze({
          ...(bodyHeadingBlockId ? { bodyHeadingBlockId } : {}),
          ...(entry.pageIndex === undefined
            ? {}
            : { pageIndex: entry.pageIndex }),
          range: entry.range,
          referenceLevel: entry.referenceLevel,
          sourceTitle: entry.sourceTitle,
        });
      }),
    ),
    matchedHeadingCount: matchedCount,
    matchConfidence,
    ...(proposedRegion ? { proposedRegion } : {}),
    requiresPdfEvidence,
    startByte,
  });
}

function finalizePrintedContentsDetection(
  candidates: readonly PrintedContentsCandidate[],
): PrintedContentsDetection {
  const canonical = candidates
    .filter((candidate) => candidate.proposedRegion)
    .toSorted(
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

export function detectPrintedContents(
  input: DetectPrintedContentsInput,
): PrintedContentsDetection {
  const context = createPrintedContentsDetectionContext(input);
  const ranges = discoverCandidateWindows(context);
  const estimatedWindows = estimateCandidateWindows(context, ranges);
  const parsedRegions = ranges.map((range) =>
    parseCandidateRegion(context, range),
  );
  const recoveredRegions = recoverCandidateRegions(context, parsedRegions);
  const candidates: PrintedContentsCandidate[] = [];

  for (const [rangeIndex, recovered] of recoveredRegions.entries()) {
    const headingIndex = indexCandidateHeadings(
      context,
      recovered,
      rangeIndex,
      estimatedWindows,
    );
    const candidateAlignment = alignCandidateHeadings(
      context,
      recovered,
      headingIndex,
    );
    const aligned = materializeAlignedCandidate(
      context,
      recovered,
      headingIndex,
      candidateAlignment,
      candidates.length,
    );
    const decision = evaluateCandidateRegion(
      context,
      recovered,
      headingIndex,
      aligned,
      candidates.length,
    );
    if (decision) {
      candidates.push(
        materializeCandidateRegion(context, recovered, aligned, decision),
      );
    }
  }

  return finalizePrintedContentsDetection(candidates);
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
