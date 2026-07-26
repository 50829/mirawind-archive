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
  /^(?:序(?:言|章)?|前言|导读|凡例|符号(?:表|说明)|preface|foreword|prologue)$/iu;
const appendixTitle =
  /^(?:附录|附表|appendix)(?:\s|[A-Z一二三四五六七八九十0-9]|$)/iu;
const backmatterTitle =
  /^(?:参考文献|参考资料|术语表|(?:译)?后记|图片来源|符号索引|索引|致谢|bibliography|references|glossary|index|afterword|acknowledg(?:e)?ments?)$/iu;
const chapterLocalTitle =
  /^(?:简要回顾|供讨论的问题|延伸思考|习题|练习|家庭作业|参考文献(?:说明)?|阅读材料|休息一会儿|bibliographic notes|exercises|review questions)$/iu;
const nonNavigationalLocalTitle = /^(?:学习目标|learning objectives?)$/iu;
const pureMajorLabel =
  /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部)|(?:chapter|part)\s*[0-9ivxlcdm]+|附录\s*[A-Za-z0-9一二三四五六七八九十]*)$/iu;
const purePartLabel =
  /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:篇|部分|部)|part\s*[0-9ivxlcdm]+)$/iu;
const pureNumericChapterMarker = /^\d{1,3}$/u;
const ornamentalPartMarker = /^p\s*a\s*r\s*t\s*[0-9ivxlcdm]+$/iu;

function nodeText(node: TransientDocumentNode): string {
  const values: string[] = [];
  const visit = (current: TransientDocumentNode) => {
    if (current.type === "text" && current.value) values.push(current.value);
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

function printedEntryRole(
  source: string,
  entry: ConfirmedSourceRegion["entries"][number],
): ContentRole | undefined {
  const bytes = Buffer.from(source, "utf8");
  if (
    entry.range.start_byte < 0 ||
    entry.range.end_byte > bytes.byteLength ||
    entry.range.start_byte >= entry.range.end_byte
  ) {
    return;
  }
  const title = bytes
    .subarray(entry.range.start_byte, entry.range.end_byte)
    .toString("utf8")
    .normalize("NFKC")
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)、]\s*)/u, "")
    .replace(/\s*(?:\.{2,}|…+|\s{2,})\s*(?:\d+|[ivxlcdm]+)\s*$/iu, "")
    .trim();
  if (inferPrintedHeadingEvidence(title)?.kind === "appendix") {
    return "appendix";
  }
  const role = proposedRole(title);
  return role === "body" ? undefined : role;
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
    readonly sourceRegions?: readonly ConfirmedSourceRegion[];
  } = {},
): StructureProposal {
  const printedLevels = new Map(
    (options.sourceRegions ?? []).flatMap((region) =>
      region.entries.flatMap((entry) =>
        entry.body_heading_block_id
          ? [[entry.body_heading_block_id, entry.reference_level] as const]
          : [],
      ),
    ),
  );
  const printedRoles = new Map(
    (options.sourceRegions ?? []).flatMap((region) =>
      region.entries.flatMap((entry) => {
        if (!entry.body_heading_block_id) return [];
        const role = printedEntryRole(document.source, entry);
        return role ? [[entry.body_heading_block_id, role] as const] : [];
      }),
    ),
  );
  const printedHeadingIds = new Set(printedLevels.keys());
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
      : firstFrontmatterIndex >= 0 &&
          firstFrontmatterIndex < firstBodyUnitIndex
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
    const coverMetadata =
      coverBoundaryIndex >= 0 &&
      index < coverBoundaryIndex &&
      !printedHeadingIds.has(heading.blockId) &&
      explicitLevel === undefined &&
      !frontmatterTitle.test(title) &&
      !appendixTitle.test(title) &&
      !backmatterTitle.test(title);
    const includeInToc =
      !coverMetadata &&
      (markdownLevelsAreUseful ||
        !hasAnyNumberedEvidence ||
        printedHeadingIds.has(heading.blockId) ||
        (!localPart && explicitLevel !== undefined) ||
        frontmatterTitle.test(title) ||
        appendixTitle.test(title) ||
        backmatterTitle.test(title) ||
        chapterLocalTitle.test(title));
    return {
      block_id: heading.blockId,
      display_level: displayLevel,
      include_in_toc: includeInToc,
      ...(displayLevel === 1
        ? {
            role:
              printedRoles.get(heading.blockId) ??
              (localBackmatterIndexes.has(index)
                ? "body"
                : proposedRole(heading.sourceTitle)),
          }
        : {}),
      starts_page: false,
    };
  });

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
  let insidePart = false;
  let firstChapterInPart = false;
  let partHeading: NormalizedHeading | undefined;
  let previousPageHeading: NormalizedHeading | undefined;
  for (const [index, heading] of document.headings.entries()) {
    const node = nodes[index];
    if (!node) continue;
    const evidence = inferPrintedHeadingEvidence(heading.sourceTitle);
    const printedRole = printedRoles.get(heading.blockId);
    const title = heading.sourceTitle.trim().normalize("NFKC");
    let major = node.display_level === 1;
    if (
      (!node.include_in_toc && node.role === "body") ||
      localPartIndexes.has(index) ||
      (!printedHeadingIds.has(heading.blockId) &&
        nonNavigationalLocalTitle.test(title))
    ) {
      major = false;
    } else if (printedRole === "appendix") {
      insidePart = false;
      firstChapterInPart = false;
      partHeading = undefined;
      major = true;
    } else if (printedRole === "frontmatter" || printedRole === "backmatter") {
      insidePart = false;
      firstChapterInPart = false;
      partHeading = undefined;
      major = true;
    } else if (evidence?.kind === "part") {
      insidePart = true;
      firstChapterInPart = true;
      partHeading = heading;
      major = true;
    } else if (evidence?.kind === "appendix") {
      insidePart = false;
      firstChapterInPart = false;
      partHeading = undefined;
      major = true;
    } else if (evidence?.kind === "chapter") {
      major =
        !insidePart ||
        !firstChapterInPart ||
        hasBodyBetween(partHeading, heading);
      firstChapterInPart = false;
    } else if (
      frontmatterTitle.test(title) ||
      (backmatterTitle.test(title) && !localBackmatterIndexes.has(index))
    ) {
      insidePart = false;
      firstChapterInPart = false;
      partHeading = undefined;
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
    if (
      !hasBodyBetween &&
      pureNumericChapterMarker.test(previousTitle) &&
      /^\p{Script=Han}/u.test(title)
    ) {
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
      (pureMajorLabel.test(previousTitle.normalize("NFKC")) ||
        previousTitle.length >= 20) &&
      inferPrintedReferenceLevel(previousTitle) !== undefined &&
      inferPrintedReferenceLevel(title) === undefined
    ) {
      previousNode.display_title = `${previousTitle}${title}`;
      node.display_level = previousNode.display_level;
      node.include_in_toc = false;
      node.starts_page = false;
    }
  }
  return Object.freeze({
    nodes: Object.freeze(nodes.map((node) => Object.freeze(node))),
  });
}
