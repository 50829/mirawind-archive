import type { NormalizedDocument, NormalizedHeading } from "./types.js";

export type ContentRole = "appendix" | "backmatter" | "body" | "frontmatter";

export interface ProposedStructureNode {
  readonly block_id: string;
  readonly display_level: number;
  readonly include_in_toc: true;
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
  /^(?:参考文献|参考资料|索引|后记|致谢|bibliography|references|index|afterword|acknowledg(?:e)?ments?)$/iu;

function proposedRole(title: string): ContentRole {
  const normalized = title.trim().normalize("NFC");
  if (frontmatterTitle.test(normalized)) return "frontmatter";
  if (appendixTitle.test(normalized)) return "appendix";
  if (backmatterTitle.test(normalized)) return "backmatter";
  return "body";
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
): StructureProposal {
  const levels = continuousLevels(document.headings);
  const nodes = document.headings.map((heading, index) => {
    const displayLevel = levels[index] ?? 1;
    return Object.freeze({
      block_id: heading.blockId,
      display_level: displayLevel,
      include_in_toc: true as const,
      ...(displayLevel === 1
        ? { role: proposedRole(heading.sourceTitle) }
        : {}),
      starts_page: displayLevel === 1,
    });
  });
  return Object.freeze({ nodes: Object.freeze(nodes) });
}
