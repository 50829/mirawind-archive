import {
  inferPrintedHeadingEvidence,
  inferPrintedReferenceLevel,
  inferPrintedReferenceLevels,
  isLocalPartHeading,
} from "@/modules/publishing/core/preparation/printed-contents";
import { SourceTextIndex } from "@/modules/publishing/core/preparation/source-text-index";
import type {
  ConfirmedSourceRegion,
  NormalizedDocument,
  NormalizedHeading,
  TransientDocumentNode,
} from "@/modules/publishing/core/preparation/document-model";

export type ContentRole = "appendix" | "backmatter" | "body" | "frontmatter";

export interface ProposedStructureNode {
  readonly block_id: string;
  readonly display_level: number;
  readonly display_title?: string;
  readonly include_in_toc: boolean;
  readonly role?: ContentRole;
  readonly starts_page: boolean;
}

export interface StructureProposal {
  readonly nodes: readonly ProposedStructureNode[];
}

const frontmatterTitle =
  /^(?:序(?:言|章)?|前言|中文版序(?:[0-9零〇一二三四五六七八九十]+)?|译者序|致学生|致教师|第\s*[0-9零〇一二三四五六七八九十百千]+\s*版\s*前言|导读|凡例|符号(?:表|说明)|出版者的话|关于作者|专家指导委员会|作者简介|译者简介|preface(?:\s+to\s+(?:the\s+)?[\p{L}\p{N} -]+\s+edition)?|foreword|prologue)$/iu;
const appendixTitle =
  /^(?:附录|附表|appendix)(?:\s|[A-Z一二三四五六七八九十0-9]|$)/iu;
const backmatterTitle =
  /^(?:参考文献|参考资料|术语表|(?:译)?后记|图片来源|符号索引|索引|致谢|bibliography|references|glossary|(?:author|subject)\s+index|index|afterword|acknowledg(?:e)?ments?|credits)$/iu;
const optionalBackmatterTitle = /^(?:glossary)$/iu;
const acknowledgementTitle = /^(?:致谢|acknowledg(?:e)?ments?)$/iu;
const chapterLocalTitle =
  /^(?:简要回顾|供讨论的问题|延伸思考|习题|练习|家庭作业|参考文献(?:说明)?|阅读材料|休息一会儿|bibliographic notes|exercises|review questions)$/iu;
const nonNavigationalLocalTitle =
  /^(?:学习目标|learning objectives?|chapter objectives?)$/iu;
const pureMajorLabel =
  /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部)|(?:chapter|part)\s*(?:[0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)|附录\s*[A-Za-z0-9一二三四五六七八九十]*)$/iu;
const purePartLabel =
  /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:篇|部分|部)|part\s*(?:[0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))$/iu;
const pureNumericChapterMarker = /^\d{1,3}$/u;
const ornamentalPartMarker =
  /^p\s*a\s*r\s*t\s*(?:[0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)$/iu;
const sectionRangeReferenceTitle =
  /^\d+(?:\s*\.\s*\d+)+(?:\s*[-~～—]\s*\d+(?:\s*\.\s*\d+)*)?\s*节$/u;
const alphabeticAppendixSectionTitle =
  /^[A-Z]\.\d+(?:\.\d+){0,2}(?=\s|、|:|：)/iu;

function localOrdinalTitle(value: string): boolean {
  if (
    sectionRangeReferenceTitle.test(value) ||
    /^\d{1,3}[.)、]\s+/u.test(value)
  ) {
    return true;
  }
  const decimal = /^(\d+(?:\s*\.\s*\d+)+)/u.exec(value)?.[1];
  if (!decimal) return false;
  const components = decimal.split(/\s*\.\s*/u).map(Number);
  return (
    components.slice(1).some((component) => component >= 100) ||
    /^\d+\s*\.\s*\d+[A-Za-z]/u.test(value)
  );
}

function nodeText(node: TransientDocumentNode): string {
  const values: string[] = [];
  const visit = (current: TransientDocumentNode) => {
    if (current.value) values.push(current.value);
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return values.join("").trim().normalize("NFKC");
}

function proposedRole(title: string): ContentRole {
  const normalized = title.trim().normalize("NFC");
  if (frontmatterTitle.test(normalized)) return "frontmatter";
  if (appendixTitle.test(normalized)) return "appendix";
  if (backmatterTitle.test(normalized)) return "backmatter";
  return "body";
}

function printedEntryTitle(
  sourceBytes: Buffer,
  entry: ConfirmedSourceRegion["entries"][number],
): string | undefined {
  if (
    entry.range.start_byte < 0 ||
    entry.range.end_byte > sourceBytes.byteLength ||
    entry.range.start_byte >= entry.range.end_byte
  ) {
    return;
  }
  return sourceBytes
    .subarray(entry.range.start_byte, entry.range.end_byte)
    .toString("utf8")
    .normalize("NFKC")
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|\d+、\s*)/u, "")
    .replace(/\s*(?:\.{2,}|…+|\s{2,})\s*(?:\d+|[ivxlcdm]+)\s*$/iu, "")
    .trim();
}

function printedTitleRole(
  title: string,
  beforeFirstBodyUnit = false,
): ContentRole | undefined {
  const semanticTitle = title
    .trim()
    .normalize("NFKC")
    .replace(
      /\s*(?:\.(?:\s*\.)+|…+|·(?:\s*·)+|\s{2,})\s*(?:\d+|[ivxlcdm]+)\s*$/iu,
      "",
    )
    .replace(/\s+(?:\d{1,5}|[ivxlcdm]+)\s*$/iu, "");
  const evidence = inferPrintedHeadingEvidence(semanticTitle);
  if (evidence?.kind === "appendix") {
    return "appendix";
  }
  if (beforeFirstBodyUnit && acknowledgementTitle.test(semanticTitle)) {
    return "frontmatter";
  }
  const role = proposedRole(semanticTitle);
  if (role !== "body") return role;
  return evidence?.kind === "part" || evidence?.kind === "chapter"
    ? "body"
    : undefined;
}

function continuousLevels(
  headings: readonly NormalizedHeading[],
): readonly number[] {
  const stack: {
    readonly displayLevel: number;
    readonly sourceLevel: number;
  }[] = [];
  return headings.map((heading) => {
    while (
      stack.length > 0 &&
      (stack.at(-1)?.sourceLevel ?? 0) >= heading.level
    ) {
      stack.pop();
    }
    const displayLevel =
      stack.length === 0
        ? 1
        : Math.min(4, (stack.at(-1)?.displayLevel ?? 0) + 1);
    stack.push({ displayLevel, sourceLevel: heading.level });
    return displayLevel;
  });
}

function collapseMissingNestedChapterLevels(
  entries: readonly {
    readonly bodyHeadingBlockId?: string;
    readonly referenceLevel: number;
    readonly sourceTitle: string;
  }[],
  headings: readonly NormalizedHeading[],
): readonly {
  readonly bodyHeadingBlockId?: string;
  readonly referenceLevel: number;
  readonly sourceTitle: string;
}[] {
  const missingLevels: number[] = [];
  const headingByBlockId = new Map(
    headings.map((heading) => [heading.blockId, heading] as const),
  );
  const headingIndexByBlockId = new Map(
    headings.map((heading, index) => [heading.blockId, index] as const),
  );
  const previousMatchedEntries = new Array<
    (typeof entries)[number] | undefined
  >(entries.length);
  const nextMatchedBlockIds = new Array<string | undefined>(entries.length);
  let previousMatchedEntry: (typeof entries)[number] | undefined;
  for (const [index, entry] of entries.entries()) {
    previousMatchedEntries[index] = previousMatchedEntry;
    if (entry.bodyHeadingBlockId) previousMatchedEntry = entry;
  }
  let nextMatchedBlockId: string | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    nextMatchedBlockIds[index] = nextMatchedBlockId;
    const blockId = entries[index]?.bodyHeadingBlockId;
    if (blockId) nextMatchedBlockId = blockId;
  }
  const hasInterveningBodyHeading = (entryIndex: number): boolean => {
    const previousEntry = previousMatchedEntries[entryIndex];
    if (
      inferPrintedHeadingEvidence(previousEntry?.sourceTitle ?? "")?.kind !==
      "part"
    ) {
      return false;
    }
    const previousBlockId = previousEntry?.bodyHeadingBlockId;
    const nextBlockId = nextMatchedBlockIds[entryIndex];
    const previousIndex = previousBlockId
      ? headingIndexByBlockId.get(previousBlockId)
      : undefined;
    const nextIndex = nextBlockId
      ? headingIndexByBlockId.get(nextBlockId)
      : undefined;
    return (
      previousIndex !== undefined &&
      nextIndex !== undefined &&
      nextIndex > previousIndex + 1
    );
  };
  return entries.map((entry, entryIndex) => {
    while (
      missingLevels.length > 0 &&
      (missingLevels.at(-1) ?? 0) >= entry.referenceLevel
    ) {
      missingLevels.pop();
    }
    const printedEvidence = inferPrintedHeadingEvidence(entry.sourceTitle);
    const bodyEvidence = entry.bodyHeadingBlockId
      ? inferPrintedHeadingEvidence(
          headingByBlockId.get(entry.bodyHeadingBlockId)?.sourceTitle ?? "",
        )
      : undefined;
    const followsMissingHierarchy =
      printedEvidence !== undefined &&
      bodyEvidence !== undefined &&
      printedEvidence.kind === bodyEvidence.kind &&
      printedEvidence.key === bodyEvidence.key;
    const referenceLevel = followsMissingHierarchy
      ? Math.max(1, entry.referenceLevel - missingLevels.length)
      : entry.referenceLevel;
    if (
      !entry.bodyHeadingBlockId &&
      entry.referenceLevel > 1 &&
      printedEvidence?.kind === "chapter" &&
      !hasInterveningBodyHeading(entryIndex)
    ) {
      missingLevels.push(entry.referenceLevel);
    }
    return Object.freeze({ ...entry, referenceLevel });
  });
}

interface HeadingGapSummary {
  readonly hasNode: boolean;
  readonly hasText: boolean;
  readonly onlyOrnamental: boolean;
}

function indexHeadingGaps(
  headings: readonly NormalizedHeading[],
  roots: readonly TransientDocumentNode[],
): {
  readonly gaps: readonly (HeadingGapSummary | undefined)[];
  readonly hasTextBetween: (
    previous: NormalizedHeading | undefined,
    current: NormalizedHeading,
  ) => boolean;
} {
  const gaps = new Array<HeadingGapSummary | undefined>(headings.length);
  const textPrefix = new Uint32Array(headings.length);
  const headingIndexByBlockId = new Map(
    headings.map((heading, index) => [heading.blockId, index] as const),
  );
  let rootCursor = 0;
  let textCount = 0;
  for (
    let headingIndex = 1;
    headingIndex < headings.length;
    headingIndex += 1
  ) {
    const previousEnd = headings[headingIndex - 1]?.position?.end.offset;
    const currentStart = headings[headingIndex]?.position?.start.offset;
    if (previousEnd === undefined || currentStart === undefined) {
      textPrefix[headingIndex] = textCount;
      continue;
    }

    let nodeCount = 0;
    let textNodeCount = 0;
    let ornamentalNodeCount = 0;
    while (rootCursor < roots.length) {
      const root = roots[rootCursor];
      const position = root?.position;
      if (
        !root ||
        !position ||
        root.type === "heading" ||
        position.start.offset < previousEnd
      ) {
        rootCursor += 1;
        continue;
      }
      if (position.end.offset > currentStart) break;
      const text = nodeText(root);
      nodeCount += 1;
      if (text.length > 0) textNodeCount += 1;
      if (ornamentalPartMarker.test(text)) ornamentalNodeCount += 1;
      rootCursor += 1;
    }
    textCount += textNodeCount;
    textPrefix[headingIndex] = textCount;
    gaps[headingIndex] = Object.freeze({
      hasNode: nodeCount > 0,
      hasText: textNodeCount > 0,
      onlyOrnamental: nodeCount > 0 && ornamentalNodeCount === nodeCount,
    });
  }

  return Object.freeze({
    gaps: Object.freeze(gaps),
    hasTextBetween(
      previous: NormalizedHeading | undefined,
      current: NormalizedHeading,
    ): boolean {
      if (!previous || !previous.position || !current.position) return true;
      const previousIndex = headingIndexByBlockId.get(previous.blockId);
      const currentIndex = headingIndexByBlockId.get(current.blockId);
      if (
        previousIndex === undefined ||
        currentIndex === undefined ||
        currentIndex <= previousIndex
      ) {
        return true;
      }
      return (
        (textPrefix[currentIndex] ?? 0) - (textPrefix[previousIndex] ?? 0) > 0
      );
    },
  });
}

function indexActiveHeadings(
  document: NormalizedDocument,
  regions: readonly ConfirmedSourceRegion[],
): Uint8Array {
  const active = new Uint8Array(document.headings.length);
  active.fill(1);
  const ranges = regions
    .filter((region) => region.applied)
    .map((region) => region.range)
    .toSorted(
      (left, right) =>
        left.start_byte - right.start_byte || right.end_byte - left.end_byte,
    );
  if (ranges.length === 0) return active;

  const sourceIndex = new SourceTextIndex(document.source);
  let rangeCursor = 0;
  let greatestEligibleEnd = Number.NEGATIVE_INFINITY;
  for (const [headingIndex, heading] of document.headings.entries()) {
    if (!heading.position) continue;
    const startByte = sourceIndex.byteOffsetAt(heading.position.start.offset);
    const endByte = sourceIndex.byteOffsetAt(heading.position.end.offset);
    while (
      rangeCursor < ranges.length &&
      (ranges[rangeCursor]?.start_byte ?? Number.POSITIVE_INFINITY) <= startByte
    ) {
      greatestEligibleEnd = Math.max(
        greatestEligibleEnd,
        ranges[rangeCursor]?.end_byte ?? Number.NEGATIVE_INFINITY,
      );
      rangeCursor += 1;
    }
    if (greatestEligibleEnd >= endByte) active[headingIndex] = 0;
  }
  return active;
}

interface PrintedStructureEntry {
  readonly bodyHeadingBlockId?: string;
  readonly referenceLevel: number;
  readonly sourceTitle: string;
}

interface StructureProposalOptions {
  readonly printedEntries?: readonly PrintedStructureEntry[];
  readonly sourceRegions?: readonly ConfirmedSourceRegion[];
}

type PrintedHeadingKind = NonNullable<
  ReturnType<typeof inferPrintedHeadingEvidence>
>["kind"];

interface StructureEvidenceIndex {
  readonly contextualNumberedLevels: readonly number[];
  readonly coverBoundaryIndex: number;
  readonly hasAnyNumberedEvidence: boolean;
  readonly hasPrintedHierarchy: boolean;
  readonly headingGaps: ReturnType<typeof indexHeadingGaps>;
  readonly localBackmatterIndexes: ReadonlySet<number>;
  readonly localPartIndexes: ReadonlySet<number>;
  readonly markdownLevelsAreUseful: boolean;
  readonly printedHeadingIds: ReadonlySet<string>;
  readonly printedKinds: ReadonlyMap<string, PrintedHeadingKind>;
  readonly printedLevels: ReadonlyMap<string, number>;
  readonly printedRoles: ReadonlyMap<string, ContentRole>;
}

interface StructureNodeState extends ProposedStructureNode {
  readonly display_title?: string;
}

function indexPrintedStructureEvidence(
  document: NormalizedDocument,
  options: StructureProposalOptions,
): StructureEvidenceIndex {
  const printedEntries = options.printedEntries ?? [];
  const projectedPrintedEntries = collapseMissingNestedChapterLevels(
    printedEntries,
    document.headings,
  );
  const sourceBytes = Buffer.from(document.source, "utf8");
  const sourceRegionLevels: [string, number][] = [];
  const sourceRegionRoles: [string, ContentRole][] = [];
  const sourceRegionKinds: [string, PrintedHeadingKind][] = [];
  for (const region of options.sourceRegions ?? []) {
    let beforeFirstBodyUnit = true;
    for (const entry of region.entries) {
      const blockId = entry.body_heading_block_id;
      if (blockId) sourceRegionLevels.push([blockId, entry.reference_level]);
      const title = printedEntryTitle(sourceBytes, entry);
      const kind = title ? inferPrintedHeadingEvidence(title)?.kind : undefined;
      const role = title
        ? printedTitleRole(title, beforeFirstBodyUnit)
        : undefined;
      if (kind === "part" || kind === "chapter") beforeFirstBodyUnit = false;
      if (blockId && role) sourceRegionRoles.push([blockId, role]);
      if (blockId && kind) sourceRegionKinds.push([blockId, kind]);
    }
  }
  const printedLevels = new Map([
    ...sourceRegionLevels,
    ...projectedPrintedEntries.flatMap((entry) =>
      entry.bodyHeadingBlockId
        ? [[entry.bodyHeadingBlockId, entry.referenceLevel] as const]
        : [],
    ),
  ]);
  let beforeFirstPrintedBodyUnit = true;
  const projectedPrintedRoles = printedEntries.flatMap((entry) => {
    const kind = inferPrintedHeadingEvidence(entry.sourceTitle)?.kind;
    const role = printedTitleRole(
      entry.sourceTitle,
      beforeFirstPrintedBodyUnit,
    );
    if (kind === "part" || kind === "chapter") {
      beforeFirstPrintedBodyUnit = false;
    }
    return role && entry.bodyHeadingBlockId
      ? [[entry.bodyHeadingBlockId, role] as const]
      : [];
  });
  const printedRoles = new Map(sourceRegionRoles);
  const projectedPrintedRoleByBlock = new Map(projectedPrintedRoles);
  for (const entry of printedEntries) {
    if (!entry.bodyHeadingBlockId) continue;
    const role = projectedPrintedRoleByBlock.get(entry.bodyHeadingBlockId);
    if (role) printedRoles.set(entry.bodyHeadingBlockId, role);
    else printedRoles.delete(entry.bodyHeadingBlockId);
  }
  const printedKinds = new Map(sourceRegionKinds);
  for (const entry of printedEntries) {
    if (!entry.bodyHeadingBlockId) continue;
    const kind = inferPrintedHeadingEvidence(entry.sourceTitle)?.kind;
    if (kind) printedKinds.set(entry.bodyHeadingBlockId, kind);
    else printedKinds.delete(entry.bodyHeadingBlockId);
  }
  const printedHeadingIds = new Set(printedLevels.keys());
  const hasPrintedHierarchy = printedHeadingIds.size > 0;
  const localPartIndexes = new Set(
    document.headings.flatMap((heading, index) =>
      !printedHeadingIds.has(heading.blockId) &&
      isLocalPartHeading(heading.sourceTitle)
        ? [index]
        : [],
    ),
  );
  const hasAnyNumberedEvidence =
    printedHeadingIds.size > 0 ||
    document.headings.some(
      (heading, index) =>
        !localPartIndexes.has(index) &&
        inferPrintedHeadingEvidence(heading.sourceTitle) !== undefined,
    );
  const firstBodyUnitIndex = document.headings.findIndex((heading, index) => {
    if (localPartIndexes.has(index)) return false;
    const kind = inferPrintedHeadingEvidence(heading.sourceTitle)?.kind;
    return kind === "chapter" || kind === "part";
  });
  const firstFrontmatterIndex = document.headings.findIndex((heading) =>
    frontmatterTitle.test(heading.sourceTitle.trim().normalize("NFKC")),
  );
  const coverBoundaryIndex =
    firstBodyUnitIndex < 0
      ? -1
      : firstFrontmatterIndex >= 0 && firstFrontmatterIndex < firstBodyUnitIndex
        ? firstFrontmatterIndex
        : firstBodyUnitIndex;
  const levelCounts = new Map<number, number>();
  for (const heading of document.headings) {
    levelCounts.set(heading.level, (levelCounts.get(heading.level) ?? 0) + 1);
  }
  const dominantMarkdownLevel = Math.max(0, ...levelCounts.values());
  const markdownLevelsAreUseful =
    levelCounts.size > 1 &&
    dominantMarkdownLevel / Math.max(1, document.headings.length) < 0.9;
  const contextualNumberedLevels = inferPrintedReferenceLevels(
    document.headings.map((heading) => heading.sourceTitle),
    {
      localPartIndexes,
      referenceLevels: new Map(
        document.headings.flatMap((heading, index) => {
          const level = printedLevels.get(heading.blockId);
          return level === undefined ? [] : [[index, level] as const];
        }),
      ),
    },
  );
  const localBackmatterIndexes = new Set(
    document.headings.flatMap((heading, index) =>
      backmatterTitle.test(heading.sourceTitle.trim().normalize("NFKC")) &&
      (contextualNumberedLevels[index] ?? 1) > 1
        ? [index]
        : [],
    ),
  );
  return Object.freeze({
    contextualNumberedLevels,
    coverBoundaryIndex,
    hasAnyNumberedEvidence,
    hasPrintedHierarchy,
    headingGaps: indexHeadingGaps(
      document.headings,
      document.root.children ?? [],
    ),
    localBackmatterIndexes,
    localPartIndexes,
    markdownLevelsAreUseful,
    printedHeadingIds,
    printedKinds,
    printedLevels,
    printedRoles,
  });
}

function inferStructureLevels(
  headings: readonly NormalizedHeading[],
  evidence: StructureEvidenceIndex,
): readonly number[] {
  const ordinaryLevels = continuousLevels(headings);
  let hasNumberedUnit = false;
  const structuralEvidence: boolean[] = [];
  const inferredLevels = headings.map((heading, index) => {
    const title = heading.sourceTitle.trim().normalize("NFKC");
    const explicitRole = evidence.localBackmatterIndexes.has(index)
      ? "body"
      : (evidence.printedRoles.get(heading.blockId) ?? proposedRole(title));
    const semanticTopLevel =
      explicitRole === "frontmatter" ||
      explicitRole === "appendix" ||
      explicitRole === "backmatter";
    const printed = evidence.printedLevels.get(heading.blockId);
    if (printed) {
      hasNumberedUnit = true;
      structuralEvidence[index] = true;
      return printed;
    }
    if (evidence.hasPrintedHierarchy && localOrdinalTitle(title)) {
      structuralEvidence[index] = false;
      return evidence.contextualNumberedLevels[index] ?? 2;
    }
    if (
      evidence.hasPrintedHierarchy &&
      !evidence.printedHeadingIds.has(heading.blockId) &&
      alphabeticAppendixSectionTitle.test(title)
    ) {
      structuralEvidence[index] = true;
      return evidence.contextualNumberedLevels[index] ?? 2;
    }
    const numbered = inferPrintedReferenceLevel(heading.sourceTitle);
    if (numbered) {
      hasNumberedUnit = true;
      structuralEvidence[index] = true;
      return evidence.contextualNumberedLevels[index] ?? numbered;
    }
    if (semanticTopLevel) {
      structuralEvidence[index] = true;
      return 1;
    }
    structuralEvidence[index] = false;
    if (
      evidence.coverBoundaryIndex >= 0 &&
      index < evidence.coverBoundaryIndex
    ) {
      return 1;
    }
    if (evidence.markdownLevelsAreUseful) return ordinaryLevels[index] ?? 1;
    return hasNumberedUnit
      ? (evidence.contextualNumberedLevels[index] ?? 2)
      : 1;
  });
  let previousLevel = 0;
  let previousStructuralLevel = 0;
  return Object.freeze(
    inferredLevels.map((level, index) => {
      const structural = structuralEvidence[index] ?? false;
      const closed = structural
        ? previousStructuralLevel === 0
          ? 1
          : Math.min(level, previousStructuralLevel + 1)
        : evidence.hasPrintedHierarchy
          ? evidence.localBackmatterIndexes.has(index)
            ? previousStructuralLevel || level
            : previousStructuralLevel >= 2
              ? Math.min(4, previousStructuralLevel + 1)
              : previousStructuralLevel || level
          : evidence.markdownLevelsAreUseful
            ? previousLevel === 0
              ? 1
              : Math.min(level, previousLevel + 1)
            : previousStructuralLevel || level;
      if (structural) previousStructuralLevel = closed;
      previousLevel = closed;
      return closed;
    }),
  );
}

function createInitialStructureNodes(
  headings: readonly NormalizedHeading[],
  levels: readonly number[],
  evidenceIndex: StructureEvidenceIndex,
): readonly StructureNodeState[] {
  let currentTopLevelRole: ContentRole = "body";
  return Object.freeze(
    headings.map((heading, index) => {
      const displayLevel = levels[index] ?? 1;
      const title = heading.sourceTitle.trim().normalize("NFKC");
      const explicitLevel = inferPrintedReferenceLevel(title);
      const localPart = evidenceIndex.localPartIndexes.has(index);
      const localOrdinal =
        evidenceIndex.hasPrintedHierarchy &&
        !evidenceIndex.printedHeadingIds.has(heading.blockId) &&
        localOrdinalTitle(title);
      const coverMetadata =
        evidenceIndex.coverBoundaryIndex >= 0 &&
        index < evidenceIndex.coverBoundaryIndex &&
        !evidenceIndex.printedHeadingIds.has(heading.blockId) &&
        explicitLevel === undefined &&
        !frontmatterTitle.test(title) &&
        !appendixTitle.test(title) &&
        !backmatterTitle.test(title);
      const unmatchedAlphabeticAppendixSection =
        evidenceIndex.hasPrintedHierarchy &&
        !evidenceIndex.printedHeadingIds.has(heading.blockId) &&
        alphabeticAppendixSectionTitle.test(title);
      const unmatchedOptionalBackmatter =
        evidenceIndex.hasPrintedHierarchy &&
        !evidenceIndex.printedHeadingIds.has(heading.blockId) &&
        optionalBackmatterTitle.test(title);
      const appendixDescendant =
        currentTopLevelRole === "appendix" && displayLevel > 1;
      const includeInToc =
        !coverMetadata &&
        (!localOrdinal || appendixDescendant) &&
        (!unmatchedAlphabeticAppendixSection || appendixDescendant) &&
        !unmatchedOptionalBackmatter &&
        !nonNavigationalLocalTitle.test(title) &&
        ((!evidenceIndex.hasPrintedHierarchy &&
          evidenceIndex.markdownLevelsAreUseful) ||
          !evidenceIndex.hasAnyNumberedEvidence ||
          evidenceIndex.printedHeadingIds.has(heading.blockId) ||
          appendixDescendant ||
          (!localPart && explicitLevel !== undefined) ||
          frontmatterTitle.test(title) ||
          appendixTitle.test(title) ||
          backmatterTitle.test(title));
      let role: ContentRole | undefined;
      const headingEvidence = inferPrintedHeadingEvidence(heading.sourceTitle);
      const matchedPrintedRole = evidenceIndex.printedRoles.get(
        heading.blockId,
      );
      if (matchedPrintedRole === "body") {
        currentTopLevelRole = matchedPrintedRole;
        role = matchedPrintedRole;
      } else if (matchedPrintedRole !== undefined && displayLevel === 1) {
        currentTopLevelRole = matchedPrintedRole;
        role = matchedPrintedRole;
      } else if (displayLevel === 1) {
        const classifiedRole = evidenceIndex.localBackmatterIndexes.has(index)
          ? "body"
          : proposedRole(heading.sourceTitle);
        const nextHeading = headings[index + 1];
        const detachedChapterMarker = Boolean(
          pureNumericChapterMarker.test(title) &&
          nextHeading &&
          /^\p{Script=Han}/u.test(nextHeading.sourceTitle.trim()) &&
          !(evidenceIndex.headingGaps.gaps[index + 1]?.hasText ?? true),
        );
        if (classifiedRole !== "body") {
          currentTopLevelRole = classifiedRole;
        } else if (
          detachedChapterMarker ||
          headingEvidence?.kind === "part" ||
          headingEvidence?.kind === "chapter"
        ) {
          currentTopLevelRole = "body";
        } else if (currentTopLevelRole === "frontmatter") {
          currentTopLevelRole = "body";
        }
        role = currentTopLevelRole;
      } else if (
        headingEvidence?.kind === "part" ||
        headingEvidence?.kind === "chapter"
      ) {
        currentTopLevelRole = "body";
        role = "body";
      }
      return Object.freeze({
        block_id: heading.blockId,
        display_level: displayLevel,
        include_in_toc: includeInToc,
        ...(role ? { role } : {}),
        starts_page: false,
      });
    }),
  );
}

function repairDetachedPartLabels(
  headings: readonly NormalizedHeading[],
  nodes: readonly StructureNodeState[],
  evidenceIndex: StructureEvidenceIndex,
): {
  readonly detachedPartLabelIndexes: ReadonlySet<number>;
  readonly nodes: readonly StructureNodeState[];
} {
  const output = nodes.slice();
  const detachedPartLabelIndexes = new Set<number>();
  for (let index = 0; index < headings.length - 1; index += 1) {
    const heading = headings[index];
    const nextHeading = headings[index + 1];
    const node = output[index];
    const nextNode = output[index + 1];
    if (!heading || !nextHeading || !node || !nextNode) continue;
    if (
      purePartLabel.test(heading.sourceTitle.trim().normalize("NFKC")) &&
      !/^第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:篇|部分|部)$/u.test(
        heading.sourceTitle.trim().normalize("NFKC"),
      ) &&
      evidenceIndex.printedKinds.get(nextHeading.blockId) === "part" &&
      (!(evidenceIndex.headingGaps.gaps[index + 1]?.hasText ?? true) ||
        (evidenceIndex.headingGaps.gaps[index + 1]?.onlyOrnamental ?? false))
    ) {
      detachedPartLabelIndexes.add(index);
      output[index] = Object.freeze({
        ...node,
        display_level: nextNode.display_level,
        include_in_toc: false,
        role: "body",
        starts_page: false,
      });
    }
  }
  return Object.freeze({
    detachedPartLabelIndexes,
    nodes: Object.freeze(output),
  });
}

function assignInitialPageStarts(
  headings: readonly NormalizedHeading[],
  nodes: readonly StructureNodeState[],
  detachedPartLabelIndexes: ReadonlySet<number>,
  evidenceIndex: StructureEvidenceIndex,
): readonly StructureNodeState[] {
  const output = nodes.slice();
  let insidePart = false;
  let firstChapterInPart = false;
  let previousPageHeading: NormalizedHeading | undefined;
  for (const [index, heading] of headings.entries()) {
    const node = output[index];
    if (!node) continue;
    const headingEvidence = inferPrintedHeadingEvidence(heading.sourceTitle);
    const semanticKind =
      evidenceIndex.printedKinds.get(heading.blockId) ?? headingEvidence?.kind;
    const title = heading.sourceTitle.trim().normalize("NFKC");
    let major = node.display_level === 1;
    if (
      !node.include_in_toc ||
      evidenceIndex.localPartIndexes.has(index) ||
      detachedPartLabelIndexes.has(index) ||
      (chapterLocalTitle.test(title) &&
        (!backmatterTitle.test(title) ||
          evidenceIndex.localBackmatterIndexes.has(index))) ||
      (!evidenceIndex.printedHeadingIds.has(heading.blockId) &&
        nonNavigationalLocalTitle.test(title))
    ) {
      major = false;
    } else if (node.role === "appendix") {
      insidePart = false;
      firstChapterInPart = false;
      major = true;
    } else if (node.role === "frontmatter" || node.role === "backmatter") {
      insidePart = false;
      firstChapterInPart = false;
      major = true;
    } else if (semanticKind === "part") {
      insidePart = true;
      firstChapterInPart = true;
      major = true;
    } else if (semanticKind === "appendix") {
      insidePart = false;
      firstChapterInPart = false;
      major = true;
    } else if (semanticKind === "chapter") {
      major = !insidePart || !firstChapterInPart;
      firstChapterInPart = false;
    } else if (
      frontmatterTitle.test(title) ||
      (backmatterTitle.test(title) &&
        !evidenceIndex.localBackmatterIndexes.has(index))
    ) {
      insidePart = false;
      firstChapterInPart = false;
      major = true;
    }
    const startsPage =
      index === 0 ||
      (major &&
        evidenceIndex.headingGaps.hasTextBetween(previousPageHeading, heading));
    output[index] = Object.freeze({ ...node, starts_page: startsPage });
    if (startsPage) previousPageHeading = heading;
  }
  return Object.freeze(output);
}

function repairDetachedHeadingPairs(
  headings: readonly NormalizedHeading[],
  nodes: readonly StructureNodeState[],
  evidenceIndex: StructureEvidenceIndex,
): {
  readonly detachedNumericChapterMarkerIndexes: ReadonlySet<number>;
  readonly nodes: readonly StructureNodeState[];
} {
  const output = nodes.slice();
  const detachedNumericChapterMarkerIndexes = new Set<number>();
  for (let index = 1; index < headings.length; index += 1) {
    const heading = headings[index];
    const previousHeading = headings[index - 1];
    const node = output[index];
    const previousNode = output[index - 1];
    if (!heading || !previousHeading || !node || !previousNode) continue;
    const title = heading.sourceTitle.trim();
    const previousTitle = previousHeading.sourceTitle.trim();
    const gap = evidenceIndex.headingGaps.gaps[index];
    const hasBodyBetween = gap?.hasNode ?? false;
    const onlyOrnamentalPartMarker =
      purePartLabel.test(previousTitle.normalize("NFKC")) &&
      (gap?.onlyOrnamental ?? false);
    const detachedNamedPart =
      purePartLabel.test(previousTitle.normalize("NFKC")) &&
      /^第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:篇|部分|部)$/u.test(
        previousTitle.normalize("NFKC"),
      );
    if (
      !hasBodyBetween &&
      detachedNamedPart &&
      evidenceIndex.printedKinds.get(heading.blockId) === "part"
    ) {
      output[index] = Object.freeze({
        ...node,
        display_level: previousNode.display_level,
        include_in_toc: true,
        role: "body",
        starts_page: true,
      });
      continue;
    }
    const detachedNamedChapter =
      pureMajorLabel.test(previousTitle.normalize("NFKC")) &&
      inferPrintedHeadingEvidence(previousTitle)?.kind === "chapter";
    if (
      !hasBodyBetween &&
      detachedNamedChapter &&
      evidenceIndex.printedKinds.get(heading.blockId) === "chapter"
    ) {
      output[index] = Object.freeze({
        ...node,
        display_level: previousNode.display_level,
        include_in_toc: true,
        role: "body",
        starts_page: true,
      });
      continue;
    }
    if (
      !hasBodyBetween &&
      pureNumericChapterMarker.test(previousTitle) &&
      (/^\p{Script=Han}/u.test(title) ||
        evidenceIndex.printedKinds.get(heading.blockId) === "chapter")
    ) {
      detachedNumericChapterMarkerIndexes.add(index - 1);
      const previousDisplayLevel = purePartLabel.test(title.normalize("NFKC"))
        ? previousNode.display_level
        : evidenceIndex.printedKinds.get(heading.blockId) === "chapter" &&
            !/^\p{Script=Han}/u.test(title)
          ? node.display_level
          : Math.min(
              3,
              (output[index - 2]?.display_level ?? node.display_level) + 1,
            );
      output[index - 1] = Object.freeze({
        ...previousNode,
        display_level: previousDisplayLevel,
        include_in_toc: false,
        starts_page: false,
      });
      output[index] = Object.freeze({
        ...node,
        display_level: 1,
        include_in_toc: true,
        role: "body",
        starts_page: true,
      });
      continue;
    }
    if (
      (!hasBodyBetween || onlyOrnamentalPartMarker) &&
      title.length >= 1 &&
      title.length <= 12 &&
      /^\p{Script=Han}+$/u.test(title) &&
      !chapterLocalTitle.test(title) &&
      /\p{Script=Han}$/u.test(previousTitle) &&
      pureMajorLabel.test(previousTitle.normalize("NFKC")) &&
      inferPrintedReferenceLevel(previousTitle) !== undefined &&
      evidenceIndex.printedKinds.get(heading.blockId) === undefined &&
      inferPrintedReferenceLevel(title) === undefined
    ) {
      output[index - 1] = Object.freeze({
        ...previousNode,
        display_title: `${previousTitle}${title}`,
      });
      output[index] = Object.freeze({
        ...node,
        display_level: previousNode.display_level,
        include_in_toc: false,
        starts_page: false,
      });
    }
  }
  return Object.freeze({
    detachedNumericChapterMarkerIndexes,
    nodes: Object.freeze(output),
  });
}

function finalizeStructureNodes(
  document: NormalizedDocument,
  nodes: readonly StructureNodeState[],
  detachedNumericChapterMarkerIndexes: ReadonlySet<number>,
  evidenceIndex: StructureEvidenceIndex,
  sourceRegions: readonly ConfirmedSourceRegion[],
): readonly ProposedStructureNode[] {
  const output = nodes.slice();
  const activeHeadings = indexActiveHeadings(document, sourceRegions);
  let inheritedRole: ContentRole = "body";
  let previousActiveLevel = 0;
  let hasNestedPartContext = false;
  for (const [index, initialNode] of output.entries()) {
    if (activeHeadings[index] === 0) continue;
    const heading = document.headings[index];
    const semanticKind = heading
      ? (evidenceIndex.printedKinds.get(heading.blockId) ??
        inferPrintedHeadingEvidence(heading.sourceTitle)?.kind)
      : undefined;
    const authoritativePrintedLevel = heading
      ? evidenceIndex.printedLevels.get(heading.blockId)
      : undefined;
    if (semanticKind === "part" && authoritativePrintedLevel === 1) {
      hasNestedPartContext = true;
    } else if (
      (semanticKind === "chapter" && authoritativePrintedLevel === 1) ||
      initialNode.role === "frontmatter" ||
      initialNode.role === "backmatter"
    ) {
      hasNestedPartContext = false;
    }
    let node = initialNode;
    if (node.display_level === 1) {
      inheritedRole = node.role ?? "body";
    } else if (node.role !== undefined && node.role !== inheritedRole) {
      const changedRole: ContentRole = node.role;
      if (
        changedRole === "body" &&
        semanticKind === "chapter" &&
        hasNestedPartContext &&
        (authoritativePrintedLevel ?? 1) > 1
      ) {
        inheritedRole = "body";
      } else {
        node = { ...node, display_level: 1, starts_page: true };
        inheritedRole = changedRole;
      }
    } else if (node.role !== undefined) {
      node = {
        block_id: node.block_id,
        display_level: node.display_level,
        ...(node.display_title === undefined
          ? {}
          : { display_title: node.display_title }),
        include_in_toc: node.include_in_toc,
        starts_page: node.starts_page,
      };
    }
    if (
      previousActiveLevel === 0 ||
      node.display_level > previousActiveLevel + 1
    ) {
      node = { ...node, display_level: previousActiveLevel + 1 };
    }
    if (
      node.display_level > 1 &&
      semanticKind !== "chapter" &&
      semanticKind !== "appendix"
    ) {
      node = { ...node, starts_page: false };
    }
    if (detachedNumericChapterMarkerIndexes.has(index)) {
      node = { ...node, starts_page: false };
    }
    output[index] = Object.freeze(node);
    previousActiveLevel = node.display_level;
  }
  return Object.freeze(output);
}

/**
 * Produces a portable initial `book.yaml` structure without mutating or
 * reordering the transient document tree.
 */
export function proposeDocumentStructure(
  document: NormalizedDocument,
  options: StructureProposalOptions = {},
): StructureProposal {
  const evidence = indexPrintedStructureEvidence(document, options);
  const levels = inferStructureLevels(document.headings, evidence);
  let nodes = createInitialStructureNodes(document.headings, levels, evidence);

  const repairedPartLabels = repairDetachedPartLabels(
    document.headings,
    nodes,
    evidence,
  );
  nodes = repairedPartLabels.nodes;
  const detachedPartLabelIndexes = repairedPartLabels.detachedPartLabelIndexes;
  nodes = assignInitialPageStarts(
    document.headings,
    nodes,
    detachedPartLabelIndexes,
    evidence,
  );
  const repairedHeadingPairs = repairDetachedHeadingPairs(
    document.headings,
    nodes,
    evidence,
  );
  nodes = repairedHeadingPairs.nodes;
  const detachedNumericChapterMarkerIndexes =
    repairedHeadingPairs.detachedNumericChapterMarkerIndexes;

  return Object.freeze({
    nodes: finalizeStructureNodes(
      document,
      nodes,
      detachedNumericChapterMarkerIndexes,
      evidence,
      options.sourceRegions ?? [],
    ),
  });
}
