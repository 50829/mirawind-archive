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
  readonly matchedHeadingCount: number;
  readonly matchConfidence: "high" | "low" | "medium";
  readonly proposedRegion?: ConfirmedSourceRegion;
  readonly startByte: number;
}

export interface PrintedContentsDetection {
  readonly canonicalRegionId?: string;
  readonly candidates: readonly PrintedContentsCandidate[];
}

interface NumberingEvidence {
  readonly kind: "appendix" | "chapter" | "decimal" | "part";
  readonly key: string;
  readonly level: number;
}

interface ExtractedEntry {
  readonly bodyHeadingBlockId?: string;
  readonly normalizedTitle: string;
  readonly numbering?: NumberingEvidence;
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
  /^(?:目\s*录|简\s*目|brief\s+contents|contents|table\s+of\s+contents)$/iu;
const dotLeader = /(?:\.(?:\s*\.)+|…{1,}|·(?:\s*·)+|_(?:\s*_)+)/u;
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
const entrySkipCost = 2.5;
const headingSkipCost = 0.05;

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function plainTitle(value: string): string {
  return value
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/u, "")
    .replace(/[ \t]{2,}$/u, "")
    .trim()
    .normalize("NFKC");
}

function numberingEvidence(value: string): NumberingEvidence | undefined {
  const plain = plainTitle(value)
    .replace(/[．。]/gu, ".")
    .replace(/\s*\.\s*/gu, ".");
  const named =
    /^(?:第\s*([0-9零〇一二三四五六七八九十百千]+)\s*(章|篇|部分|部)|(?:chapter|chap\.?)\s*([0-9ivxlcdm]+)|part\s*([0-9ivxlcdm]+)|附录\s*([A-Za-z0-9一二三四五六七八九十]*))/iu.exec(
      plain,
    );
  if (named) {
    const chineseKind = named[2];
    const kind =
      chineseKind === "部分" || chineseKind === "部" || chineseKind === "篇"
        ? "part"
        : named[3]
          ? "chapter"
          : named[4]
            ? "part"
            : named[5] !== undefined
              ? "appendix"
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
    )?.[1] ?? /^(\d{1,2})(?=\s+[A-Za-z])/u.exec(plain)?.[1];
  if (!decimal) return;
  return Object.freeze({
    kind: "decimal",
    key: decimal,
    level: Math.min(4, decimal.split(".").length),
  });
}

export function inferPrintedReferenceLevel(value: string): number | undefined {
  return numberingEvidence(value)?.level;
}

export function inferPrintedReferenceLevels(
  values: readonly string[],
): readonly number[] {
  let insidePart = false;
  let previousLevel = 0;
  return Object.freeze(
    values.map((value) => {
      const numbering = numberingEvidence(value);
      let level: number;
      if (numbering?.kind === "part") {
        insidePart = true;
        level = 1;
      } else if (numbering?.kind === "appendix") {
        insidePart = false;
        level = 1;
      } else if (numbering?.kind === "chapter") {
        level = insidePart ? 2 : 1;
      } else if (numbering?.kind === "decimal") {
        level = Math.min(4, numbering.level + (insidePart ? 1 : 0));
      } else if (
        /^(?:参考文献|参考资料|索引|后记|致谢|bibliography|references|index|afterword|acknowledg(?:e)?ments?)$/iu.test(
          plainTitle(value),
        )
      ) {
        insidePart = false;
        level = 1;
      } else if (
        /^(?:参考文献(?:说明)?|练习题答案|家庭作业|习题|练习|bibliographic notes|exercises|review questions)$/iu.test(
          plainTitle(value),
        ) &&
        previousLevel > 0
      ) {
        level = Math.min(4, 2 + (insidePart ? 1 : 0));
      } else {
        level = previousLevel > 0 ? previousLevel : 1;
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
    title.length < 3 ||
    /^(?:chapter|chap\.?|part|section|第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部))$/iu.test(
      title,
    )
  ) {
    return;
  }
  return Object.freeze({ pageLabel, title });
}

function normalizedTitle(value: string): string {
  const plain = plainTitle(value);
  const withoutPage = printedPageEvidence(plain)?.title ?? plain;
  const numbering = numberingEvidence(withoutPage);
  const withoutNumber = numbering
    ? withoutPage.slice(
        /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部)|(?:chapter|chap\.?)\s*[0-9ivxlcdm]+|part\s*[0-9ivxlcdm]+|附录\s*[A-Za-z0-9一二三四五六七八九十]*|\d+(?:\.\d+){0,3})/iu.exec(
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
  numbering: NumberingEvidence | undefined,
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

function lineEntries(input: {
  readonly allowPlain: boolean;
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
    const plain = plainTitle(line);
    const numbering = numberingEvidence(plain);
    const hasPrintedPage = printedPageEvidence(plain) !== undefined;
    const hasDotLeader = dotLeader.test(plain);
    const plainCandidate =
      input.allowPlain &&
      plain.length > 0 &&
      plain.length <= 80 &&
      !contentsTitle.test(plain) &&
      !/[，,。.;；！？!?]/u.test(plain) &&
      !/^(?:!\[|<|```|\|)/u.test(plain);
    if (hasPrintedPage || hasDotLeader || numbering || plainCandidate) {
      const title = normalizedTitle(line);
      if (title) {
        const startOffset = input.block.position.start.offset + lineOffset;
        const endOffset = startOffset + line.length;
        const startByte = utf8ByteOffset(input.source, startOffset);
        const endByte = utf8ByteOffset(input.source, endOffset);
        const referenceLevel = contextualLevel(line, numbering, previousLevel);
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
            sourceTitle: line,
          }),
        );
      }
    }
    lineOffset += line.length + 1;
  }
  return Object.freeze(entries);
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

function matchScore(entry: ExtractedEntry, heading: NormalizedHeading): number {
  const headingTitle = normalizedTitle(heading.sourceTitle);
  const headingNumber = numberingEvidence(heading.sourceTitle);
  const titleScore = similarity(entry.normalizedTitle, headingTitle);
  const numberEqual =
    entry.numbering &&
    headingNumber &&
    entry.numbering.key === headingNumber.key;
  const numberConflict =
    entry.numbering &&
    headingNumber &&
    entry.numbering.key !== headingNumber.key;
  if (
    numberConflict ||
    (!numberEqual && titleScore < 0.62) ||
    (numberEqual && titleScore < 0.2)
  ) {
    return 0;
  }
  return Math.round(titleScore * 10) + (numberEqual ? 8 : 0);
}

function monotonicMatches(
  entries: readonly ExtractedEntry[],
  headings: readonly NormalizedHeading[],
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
    const title = normalizedTitle(heading.sourceTitle);
    exactHeadings.set(title, [...(exactHeadings.get(title) ?? []), index]);
    const number = numberingEvidence(heading.sourceTitle);
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
        if (
          normalizedTitle(heading.sourceTitle).slice(0, 4) ===
          entry.normalizedTitle.slice(0, 4)
        ) {
          indexes.add(headingIndex);
        }
        if (indexes.size >= 50) break;
      }
    }
    for (const headingIndex of indexes) {
      const heading = headings[headingIndex];
      if (!heading) continue;
      const score = matchScore(entry, heading);
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
  for (const [entryIndex, headingIndex] of [...matches]) {
    const chosen = candidates.find(
      (item) =>
        item.entryIndex === entryIndex && item.headingIndex === headingIndex,
    );
    const entry = entries[entryIndex];
    const heading = headings[headingIndex];
    if (!chosen || !entry || !heading) continue;
    const exactNumber = Boolean(
      entry.numbering &&
      entry.numbering.key === numberingEvidence(heading.sourceTitle)?.key,
    );
    if (
      !exactNumber &&
      candidates.some(
        (item) =>
          item.entryIndex === entryIndex &&
          item.headingIndex !== headingIndex &&
          item.score >= chosen.score - 1,
      )
    ) {
      ambiguousEntries.add(entryIndex);
      matches.delete(entryIndex);
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
      numberingEvidence(record.text) || printedPageEvidence(record.text),
  );
  const inferredLevels = inferPrintedReferenceLevels(
    rows.map((record) => record.text),
  );
  const explicit = rows.flatMap((record, index) => {
    const number = numberingEvidence(record.text);
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
    let level = inferredLevels[index];
    if (!level && medians.size > 0) {
      level = [...medians].sort(
        (left, right) =>
          Math.abs(left[1] - row.indent) - Math.abs(right[1] - row.indent),
      )[0]?.[0];
    }
    if (level) {
      const key = normalizedTitle(row.text);
      output.set(key, [...(output.get(key) ?? []), level]);
    }
  }
  return output;
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
    readonly startIndex: number;
  }[] = [];
  const explicitLabels = roots.flatMap((root, index) =>
    contentsTitle.test(rootTitle(root).normalize("NFKC")) ? [index] : [],
  );
  for (const [labelIndex, startIndex] of explicitLabels.entries()) {
    ranges.push({
      endIndex: (explicitLabels[labelIndex + 1] ?? roots.length) - 1,
      explicit: true,
      startIndex,
    });
  }
  if (ranges.length === 0) {
    const searchLimit = Math.min(roots.length, 100);
    for (let index = 0; index < searchLimit; index += 1) {
      if (index / Math.max(1, roots.length) > 0.5) break;
      const root = roots[index];
      if (!root?.position) continue;
      const seed = lineEntries({
        allowPlain: false,
        block: root,
        previousLevel: 0,
        source: input.document.source,
        sourceBytes,
      });
      if (seed.length > 0) {
        ranges.push({
          endIndex: roots.length - 1,
          explicit: false,
          startIndex: index,
        });
        break;
      }
    }
  }

  const candidates: PrintedContentsCandidate[] = [];
  for (const range of ranges) {
    const entries: ExtractedEntry[] = [];
    let candidateEndIndex = range.startIndex;
    let richContent = false;
    let noiseBlocks = 0;
    const firstEntryIndex = range.explicit
      ? range.startIndex + 1
      : range.startIndex;
    for (let index = firstEntryIndex; index <= range.endIndex; index += 1) {
      const block = roots[index];
      if (!block?.position) continue;
      const possibleBodyTitle =
        block.type === "heading" ? normalizedTitle(rootTitle(block)) : "";
      if (
        entries.length > 0 &&
        possibleBodyTitle &&
        entries.some((entry) => entry.normalizedTitle === possibleBodyTitle) &&
        printedPageEvidence(rootTitle(block)) === undefined
      ) {
        break;
      }
      const extracted = lineEntries({
        allowPlain: range.explicit,
        block,
        previousLevel: entries.at(-1)?.referenceLevel ?? 0,
        source: input.document.source,
        sourceBytes,
      });
      if (containsRichContent(block)) richContent = true;
      if (extracted.length > 0) {
        entries.push(...extracted);
        candidateEndIndex = index;
        noiseBlocks = 0;
      } else if (entries.length > 0) {
        noiseBlocks += 1;
        if (noiseBlocks > 2) break;
      }
      if (entries.length > 20_000) break;
    }
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
      const proposedLevel = entry.numbering
        ? (inferredLevels[index] ?? entry.referenceLevel)
        : (layoutLevel ?? inferredLevels[index] ?? entry.referenceLevel);
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
    const laterHeadings = input.document.headings.filter(
      (heading) =>
        (heading.position?.start.offset ?? Number.NEGATIVE_INFINITY) >
          candidateEndOffset &&
        !contentsTitle.test(heading.sourceTitle.normalize("NFKC")) &&
        printedPageEvidence(heading.sourceTitle) === undefined,
    );
    const alignment = monotonicMatches(entries, laterHeadings);
    const diagnostics: PrintedContentsDiagnostic[] = [];
    const matchedEntries = entries.map((entry, entryIndex) => {
      if (alignment.ambiguousEntries.has(entryIndex)) {
        diagnostics.push(
          diagnostic(
            "PRINTED_TOC_AMBIGUOUS_MATCH",
            `candidates/${candidates.length}/entries/${entryIndex}`,
          ),
        );
        return entry;
      }
      const headingIndex = alignment.matches.get(entryIndex);
      const match =
        headingIndex === undefined ? undefined : laterHeadings[headingIndex];
      if (!match) {
        diagnostics.push(
          diagnostic(
            "PRINTED_TOC_UNMATCHED_ENTRY",
            `candidates/${candidates.length}/entries/${entryIndex}`,
          ),
        );
        return entry;
      }
      return Object.freeze({ ...entry, bodyHeadingBlockId: match.blockId });
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
    if (entries.length < 3) {
      diagnostics.push(
        diagnostic(
          "PRINTED_TOC_INSUFFICIENT_ENTRIES",
          `candidates/${candidates.length}`,
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
        diagnostic("PRINTED_TOC_LEVEL_GAP", `candidates/${candidates.length}`),
      );
    }
    if (richContent) {
      diagnostics.push(
        diagnostic(
          "PRINTED_TOC_RICH_CONTENT",
          `candidates/${candidates.length}`,
        ),
      );
    }
    const matchedCount = matchedEntries.filter(
      (entry) => entry.bodyHeadingBlockId,
    ).length;
    const coverage = entries.length === 0 ? 0 : matchedCount / entries.length;
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
    const recurrenceCount = entries.filter((entry) =>
      laterHeadings.some((heading) => matchScore(entry, heading) > 0),
    ).length;
    const recurrenceCoverage =
      entries.length === 0 ? 0 : recurrenceCount / entries.length;
    const boundaryEvidenceCount = entries.filter(
      (entry) =>
        entry.numbering !== undefined ||
        printedPageEvidence(entry.sourceTitle) !== undefined ||
        dotLeader.test(entry.sourceTitle),
    ).length;
    const frontmatter = range.startIndex / Math.max(1, roots.length) <= 0.5;
    let boundaryScore = range.explicit ? 2 : 0;
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
    const matchConfidence =
      coverage >= 0.8 && alignment.margin >= 2
        ? "high"
        : coverage >= 0.5
          ? "medium"
          : "low";
    const canApplyBoundary =
      boundaryConfidence === "high" &&
      entries.length >= 2 &&
      !richContent &&
      !diagnostics.some((item) => item.code === "PRINTED_TOC_LEVEL_GAP");
    const proposedRegion = canApplyBoundary
      ? Object.freeze({
          applied: true,
          disposition: "reference_only" as const,
          entries: Object.freeze(
            matchedEntries.map((entry) =>
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
        entryCount: entries.length,
        matchedHeadingCount: matchedCount,
        matchConfidence,
        ...(proposedRegion ? { proposedRegion } : {}),
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
