import {
  inferPrintedHeadingEvidence,
  inferPrintedReferenceLevel,
  inferPrintedReferenceLevels,
  isLocalPartHeading,
} from "./printed-toc.js";
import type {
  ConfirmedSourceRegion,
  NormalizedDocument,
  NormalizedHeading,
  TransientDocumentNode,
} from "./types.js";

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
  source: string,
  entry: ConfirmedSourceRegion["entries"][number],
): string | undefined {
  const bytes = Buffer.from(source, "utf8");
  if (
    entry.range.start_byte < 0 ||
    entry.range.end_byte > bytes.byteLength ||
    entry.range.start_byte >= entry.range.end_byte
  ) {
    return;
  }
  return bytes
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

/**
 * Produces a portable initial `book.yaml` structure without mutating or
 * reordering the transient document tree.
 */
export function proposeDocumentStructure(
  document: NormalizedDocument,
  options: {
    readonly printedEntries?: readonly {
      readonly bodyHeadingBlockId?: string;
      readonly referenceLevel: number;
      readonly sourceTitle: string;
    }[];
    readonly sourceRegions?: readonly ConfirmedSourceRegion[];
  } = {},
): StructureProposal {
  const printedLevels = new Map([
    ...(options.sourceRegions ?? []).flatMap((region) =>
      region.entries.flatMap((entry) =>
        entry.body_heading_block_id
          ? [[entry.body_heading_block_id, entry.reference_level] as const]
          : [],
      ),
    ),
    ...(options.printedEntries ?? []).flatMap((entry) =>
      entry.bodyHeadingBlockId
        ? [[entry.bodyHeadingBlockId, entry.referenceLevel] as const]
        : [],
    ),
  ]);
  const sourceRegionRoles = (options.sourceRegions ?? []).flatMap((region) => {
    let beforeFirstBodyUnit = true;
    return region.entries.flatMap((entry) => {
      const title = printedEntryTitle(document.source, entry);
      const kind = title ? inferPrintedHeadingEvidence(title)?.kind : undefined;
      const role = title
        ? printedTitleRole(title, beforeFirstBodyUnit)
        : undefined;
      if (kind === "part" || kind === "chapter") beforeFirstBodyUnit = false;
      if (!entry.body_heading_block_id || !role) return [];
      return [[entry.body_heading_block_id, role] as const];
    });
  });
  let beforeFirstPrintedBodyUnit = true;
  const projectedPrintedRoles = (options.printedEntries ?? []).flatMap(
    (entry) => {
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
    },
  );
  const printedRoles = new Map(sourceRegionRoles);
  const projectedPrintedRoleByBlock = new Map(projectedPrintedRoles);
  for (const entry of options.printedEntries ?? []) {
    if (!entry.bodyHeadingBlockId) continue;
    const role = projectedPrintedRoleByBlock.get(entry.bodyHeadingBlockId);
    if (role) printedRoles.set(entry.bodyHeadingBlockId, role);
    else printedRoles.delete(entry.bodyHeadingBlockId);
  }
  const printedKinds = new Map([
    ...(options.sourceRegions ?? []).flatMap((region) =>
      region.entries.flatMap((entry) => {
        if (!entry.body_heading_block_id) return [];
        const title = printedEntryTitle(document.source, entry);
        const kind = title
          ? inferPrintedHeadingEvidence(title)?.kind
          : undefined;
        return kind ? [[entry.body_heading_block_id, kind] as const] : [];
      }),
    ),
  ]);
  for (const entry of options.printedEntries ?? []) {
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
  const ordinaryLevels = continuousLevels(document.headings);
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
  let hasNumberedUnit = false;
  const structuralEvidence: boolean[] = [];
  const inferredLevels = document.headings.map((heading, index) => {
    const title = heading.sourceTitle.trim().normalize("NFKC");
    const explicitRole = localBackmatterIndexes.has(index)
      ? "body"
      : (printedRoles.get(heading.blockId) ?? proposedRole(title));
    const semanticTopLevel =
      explicitRole === "frontmatter" ||
      explicitRole === "appendix" ||
      explicitRole === "backmatter";
    const printed = printedLevels.get(heading.blockId);
    if (printed) {
      hasNumberedUnit = true;
      structuralEvidence[index] = true;
      return printed;
    }
    if (hasPrintedHierarchy && localOrdinalTitle(title)) {
      structuralEvidence[index] = false;
      return contextualNumberedLevels[index] ?? 2;
    }
    if (
      hasPrintedHierarchy &&
      !printedHeadingIds.has(heading.blockId) &&
      alphabeticAppendixSectionTitle.test(title)
    ) {
      structuralEvidence[index] = false;
      return contextualNumberedLevels[index] ?? 2;
    }
    const numbered = inferPrintedReferenceLevel(heading.sourceTitle);
    if (numbered) {
      hasNumberedUnit = true;
      const contextualLevel = contextualNumberedLevels[index] ?? numbered;
      structuralEvidence[index] = true;
      return contextualLevel;
    }
    if (semanticTopLevel) {
      structuralEvidence[index] = true;
      return 1;
    }
    structuralEvidence[index] = false;
    if (coverBoundaryIndex >= 0 && index < coverBoundaryIndex) return 1;
    if (markdownLevelsAreUseful) return ordinaryLevels[index] ?? 1;
    return hasNumberedUnit ? (contextualNumberedLevels[index] ?? 2) : 1;
  });
  let previousLevel = 0;
  let previousStructuralLevel = 0;
  const levels = inferredLevels.map((level, index) => {
    const structural = structuralEvidence[index] ?? false;
    const closed = structural
      ? previousStructuralLevel === 0
        ? 1
        : Math.min(level, previousStructuralLevel + 1)
      : hasPrintedHierarchy
        ? localBackmatterIndexes.has(index)
          ? previousStructuralLevel || level
          : previousStructuralLevel >= 2
            ? Math.min(4, previousStructuralLevel + 1)
            : previousStructuralLevel || level
        : markdownLevelsAreUseful
          ? previousLevel === 0
            ? 1
            : Math.min(level, previousLevel + 1)
          : previousStructuralLevel || level;
    if (structural) previousStructuralLevel = closed;
    previousLevel = closed;
    return closed;
  });
  const roots = document.root.children ?? [];
  const hasBodyBetweenHeadings = (
    previous: NormalizedHeading,
    current: NormalizedHeading,
  ): boolean => {
    const previousEnd = previous.position?.end.offset;
    const currentStart = current.position?.start.offset;
    if (previousEnd === undefined || currentStart === undefined) return true;
    return roots.some(
      (root) =>
        root.type !== "heading" &&
        root.position &&
        root.position.start.offset >= previousEnd &&
        root.position.end.offset <= currentStart &&
        nodeText(root).length > 0,
    );
  };
  let currentTopLevelRole: ContentRole = "body";
  const nodes: {
    block_id: string;
    display_level: number;
    display_title?: string;
    include_in_toc: boolean;
    role?: ContentRole;
    starts_page: boolean;
  }[] = document.headings.map((heading, index) => {
    const displayLevel = levels[index] ?? 1;
    const title = heading.sourceTitle.trim().normalize("NFKC");
    const explicitLevel = inferPrintedReferenceLevel(title);
    const localPart = localPartIndexes.has(index);
    const localOrdinal =
      hasPrintedHierarchy &&
      !printedHeadingIds.has(heading.blockId) &&
      localOrdinalTitle(title);
    const coverMetadata =
      coverBoundaryIndex >= 0 &&
      index < coverBoundaryIndex &&
      !printedHeadingIds.has(heading.blockId) &&
      explicitLevel === undefined &&
      !frontmatterTitle.test(title) &&
      !appendixTitle.test(title) &&
      !backmatterTitle.test(title);
    const unmatchedAlphabeticAppendixSection =
      hasPrintedHierarchy &&
      !printedHeadingIds.has(heading.blockId) &&
      alphabeticAppendixSectionTitle.test(title);
    const unmatchedOptionalBackmatter =
      hasPrintedHierarchy &&
      !printedHeadingIds.has(heading.blockId) &&
      optionalBackmatterTitle.test(title);
    const includeInToc =
      !coverMetadata &&
      !localOrdinal &&
      !unmatchedAlphabeticAppendixSection &&
      !unmatchedOptionalBackmatter &&
      !nonNavigationalLocalTitle.test(title) &&
      ((!hasPrintedHierarchy && markdownLevelsAreUseful) ||
        !hasAnyNumberedEvidence ||
        printedHeadingIds.has(heading.blockId) ||
        (!localPart && explicitLevel !== undefined) ||
        frontmatterTitle.test(title) ||
        appendixTitle.test(title) ||
        backmatterTitle.test(title));
    let role: ContentRole | undefined;
    const evidence = inferPrintedHeadingEvidence(heading.sourceTitle);
    const matchedPrintedRole = printedRoles.get(heading.blockId);
    if (matchedPrintedRole === "body") {
      currentTopLevelRole = matchedPrintedRole;
      role = matchedPrintedRole;
    } else if (matchedPrintedRole !== undefined && displayLevel === 1) {
      currentTopLevelRole = matchedPrintedRole;
      role = matchedPrintedRole;
    } else if (displayLevel === 1) {
      const classifiedRole = localBackmatterIndexes.has(index)
        ? "body"
        : proposedRole(heading.sourceTitle);
      const nextHeading = document.headings[index + 1];
      const detachedChapterMarker = Boolean(
        pureNumericChapterMarker.test(title) &&
        nextHeading &&
        /^\p{Script=Han}/u.test(nextHeading.sourceTitle.trim()) &&
        !hasBodyBetweenHeadings(heading, nextHeading),
      );
      if (classifiedRole !== "body") {
        currentTopLevelRole = classifiedRole;
      } else if (
        detachedChapterMarker ||
        evidence?.kind === "part" ||
        evidence?.kind === "chapter"
      ) {
        currentTopLevelRole = "body";
      } else if (currentTopLevelRole === "frontmatter") {
        currentTopLevelRole = "body";
      }
      role = currentTopLevelRole;
    } else if (evidence?.kind === "part" || evidence?.kind === "chapter") {
      currentTopLevelRole = "body";
      role = "body";
    }
    return {
      block_id: heading.blockId,
      display_level: displayLevel,
      include_in_toc: includeInToc,
      ...(role ? { role } : {}),
      starts_page: false,
    };
  });

  let suppressUnlistedAppendixChildren = false;
  let suppressedAppendixLevel = 1;
  for (const [index, heading] of document.headings.entries()) {
    const node = nodes[index];
    if (!node) continue;
    const printedLevel = printedLevels.get(heading.blockId);
    const printedRole = printedRoles.get(heading.blockId);
    const evidence = inferPrintedHeadingEvidence(heading.sourceTitle);
    if (printedLevel !== undefined) {
      suppressUnlistedAppendixChildren =
        printedLevel === 1 && printedRole === "appendix";
      suppressedAppendixLevel = printedLevel;
      continue;
    }
    if (!suppressUnlistedAppendixChildren) continue;
    if (evidence?.kind === "appendix") {
      suppressUnlistedAppendixChildren = false;
      continue;
    }
    if (backmatterTitle.test(heading.sourceTitle.trim().normalize("NFKC"))) {
      suppressUnlistedAppendixChildren = false;
      continue;
    }
    node.display_level = suppressedAppendixLevel;
    node.include_in_toc = false;
  }

  const hasBodyBetween = (
    previous: NormalizedHeading | undefined,
    current: NormalizedHeading,
  ): boolean => {
    if (!previous) return true;
    const previousEnd = previous.position?.end.offset;
    const currentStart = current.position?.start.offset;
    if (previousEnd === undefined || currentStart === undefined) return true;
    return roots.some(
      (root) =>
        root.type !== "heading" &&
        root.position &&
        root.position.start.offset >= previousEnd &&
        root.position.end.offset <= currentStart &&
        nodeText(root).length > 0,
    );
  };
  const detachedPartLabelIndexes = new Set<number>();
  const detachedNumericChapterMarkerIndexes = new Set<number>();
  const onlyOrnamentalPartBetween = (
    previous: NormalizedHeading,
    current: NormalizedHeading,
  ): boolean => {
    const previousEnd = previous.position?.end.offset;
    const currentStart = current.position?.start.offset;
    if (previousEnd === undefined || currentStart === undefined) return false;
    const intervening = roots.filter(
      (root) =>
        root.type !== "heading" &&
        root.position &&
        root.position.start.offset >= previousEnd &&
        root.position.end.offset <= currentStart,
    );
    return (
      intervening.length > 0 &&
      intervening.every((root) => ornamentalPartMarker.test(nodeText(root)))
    );
  };
  for (let index = 0; index < document.headings.length - 1; index += 1) {
    const heading = document.headings[index];
    const nextHeading = document.headings[index + 1];
    const node = nodes[index];
    const nextNode = nodes[index + 1];
    if (!heading || !nextHeading || !node || !nextNode) continue;
    if (
      purePartLabel.test(heading.sourceTitle.trim().normalize("NFKC")) &&
      !/^第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:篇|部分|部)$/u.test(
        heading.sourceTitle.trim().normalize("NFKC"),
      ) &&
      printedKinds.get(nextHeading.blockId) === "part" &&
      (!hasBodyBetween(heading, nextHeading) ||
        onlyOrnamentalPartBetween(heading, nextHeading))
    ) {
      detachedPartLabelIndexes.add(index);
      node.display_level = nextNode.display_level;
      node.include_in_toc = false;
      node.role = "body";
      node.starts_page = false;
    }
  }
  let insidePart = false;
  let firstChapterInPart = false;
  let previousPageHeading: NormalizedHeading | undefined;
  for (const [index, heading] of document.headings.entries()) {
    const node = nodes[index];
    if (!node) continue;
    const evidence = inferPrintedHeadingEvidence(heading.sourceTitle);
    const semanticKind = printedKinds.get(heading.blockId) ?? evidence?.kind;
    const title = heading.sourceTitle.trim().normalize("NFKC");
    let major = node.display_level === 1;
    if (
      !node.include_in_toc ||
      localPartIndexes.has(index) ||
      detachedPartLabelIndexes.has(index) ||
      (chapterLocalTitle.test(title) &&
        (!backmatterTitle.test(title) || localBackmatterIndexes.has(index))) ||
      (!printedHeadingIds.has(heading.blockId) &&
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
      (backmatterTitle.test(title) && !localBackmatterIndexes.has(index))
    ) {
      insidePart = false;
      firstChapterInPart = false;
      major = true;
    }
    const startsPage =
      index === 0 || (major && hasBodyBetween(previousPageHeading, heading));
    node.starts_page = startsPage;
    if (startsPage) previousPageHeading = heading;
  }
  for (let index = 1; index < document.headings.length; index += 1) {
    const heading = document.headings[index];
    const previousHeading = document.headings[index - 1];
    const node = nodes[index];
    const previousNode = nodes[index - 1];
    if (!heading || !previousHeading || !node || !previousNode) continue;
    const title = heading.sourceTitle.trim();
    const previousTitle = previousHeading.sourceTitle.trim();
    const previousEnd = previousHeading.position?.end.offset;
    const currentStart = heading.position?.start.offset;
    const interveningBody =
      previousEnd !== undefined &&
      currentStart !== undefined &&
      roots.filter(
        (root) =>
          root.type !== "heading" &&
          root.position &&
          root.position.start.offset >= previousEnd &&
          root.position.end.offset <= currentStart,
      );
    const hasBodyBetween =
      Array.isArray(interveningBody) && interveningBody.length > 0;
    const onlyOrnamentalPartMarker =
      purePartLabel.test(previousTitle.normalize("NFKC")) &&
      Array.isArray(interveningBody) &&
      interveningBody.length > 0 &&
      interveningBody.every((root) =>
        ornamentalPartMarker.test(nodeText(root)),
      );
    const detachedNamedPart =
      purePartLabel.test(previousTitle.normalize("NFKC")) &&
      /^第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:篇|部分|部)$/u.test(
        previousTitle.normalize("NFKC"),
      );
    if (
      !hasBodyBetween &&
      detachedNamedPart &&
      printedKinds.get(heading.blockId) === "part"
    ) {
      node.display_level = previousNode.display_level;
      node.include_in_toc = true;
      node.role = "body";
      node.starts_page = true;
      continue;
    }
    const detachedNamedChapter =
      pureMajorLabel.test(previousTitle.normalize("NFKC")) &&
      inferPrintedHeadingEvidence(previousTitle)?.kind === "chapter";
    if (
      !hasBodyBetween &&
      detachedNamedChapter &&
      printedKinds.get(heading.blockId) === "chapter"
    ) {
      node.display_level = previousNode.display_level;
      node.include_in_toc = true;
      node.role = "body";
      node.starts_page = true;
      continue;
    }
    if (
      !hasBodyBetween &&
      pureNumericChapterMarker.test(previousTitle) &&
      (/^\p{Script=Han}/u.test(title) ||
        printedKinds.get(heading.blockId) === "chapter")
    ) {
      detachedNumericChapterMarkerIndexes.add(index - 1);
      if (!purePartLabel.test(title.normalize("NFKC"))) {
        const precedingLevel = nodes[index - 2]?.display_level;
        previousNode.display_level = Math.min(
          3,
          (precedingLevel ?? node.display_level) + 1,
        );
      }
      previousNode.include_in_toc = false;
      previousNode.starts_page = false;
      node.display_level = 1;
      node.include_in_toc = true;
      node.role = "body";
      node.starts_page = true;
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
      printedKinds.get(heading.blockId) === undefined &&
      inferPrintedReferenceLevel(title) === undefined
    ) {
      previousNode.display_title = `${previousTitle}${title}`;
      node.display_level = previousNode.display_level;
      node.include_in_toc = false;
      node.starts_page = false;
    }
  }

  const appliedRegionRanges = (options.sourceRegions ?? [])
    .filter((region) => region.applied)
    .map((region) => region.range);
  const activeHeading = (index: number): boolean => {
    const position = document.headings[index]?.position;
    if (!position) return true;
    const startByte = Buffer.byteLength(
      document.source.slice(0, position.start.offset),
      "utf8",
    );
    const endByte = Buffer.byteLength(
      document.source.slice(0, position.end.offset),
      "utf8",
    );
    return !appliedRegionRanges.some(
      (range) => range.start_byte <= startByte && endByte <= range.end_byte,
    );
  };
  let inheritedRole: ContentRole = "body";
  let previousActiveLevel = 0;
  for (const [index, node] of nodes.entries()) {
    if (!activeHeading(index)) continue;
    if (node.display_level === 1) {
      inheritedRole = node.role ?? "body";
    } else if (node.role !== undefined && node.role !== inheritedRole) {
      node.display_level = 1;
      node.starts_page = true;
      inheritedRole = node.role;
    } else {
      delete node.role;
    }
    if (
      previousActiveLevel === 0 ||
      node.display_level > previousActiveLevel + 1
    ) {
      node.display_level = previousActiveLevel + 1;
    }
    const heading = document.headings[index];
    const semanticKind = heading
      ? (printedKinds.get(heading.blockId) ??
        inferPrintedHeadingEvidence(heading.sourceTitle)?.kind)
      : undefined;
    if (
      node.display_level > 1 &&
      semanticKind !== "chapter" &&
      semanticKind !== "appendix"
    ) {
      node.starts_page = false;
    }
    if (detachedNumericChapterMarkerIndexes.has(index)) {
      node.starts_page = false;
    }
    previousActiveLevel = node.display_level;
  }

  return Object.freeze({
    nodes: Object.freeze(nodes.map((node) => Object.freeze(node))),
  });
}
