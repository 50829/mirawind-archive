import type { BookDocument, HeadingBlock } from "./book-document.generated";
import { contentEntries, inlineText } from "./content-tree";

export type HeadingNumberingMode = BookDocument["publishing"]["numbering"];
export type ContentRole = "frontmatter" | "body" | "appendix" | "backmatter";
export interface PresentedHeading {
  readonly heading: HeadingBlock;
  readonly role: ContentRole;
  readonly number: string | null;
  readonly title: string;
  readonly label: string;
  readonly numberingExcluded: boolean;
}

export function presentBookHeadings(
  book: Pick<BookDocument, "blocks" | "publishing">,
): readonly PresentedHeading[] {
  const entries = [...contentEntries(book.blocks)];
  const indexes = new Map(
    entries.map((entry, index) => [entry.node.id, index]),
  );
  const boundaries = book.publishing.boundaries;
  const body = indexes.get(boundaries.body_start_block_id) ?? 0;
  const appendix = boundaries.appendix_start_block_id
    ? indexes.get(boundaries.appendix_start_block_id)
    : undefined;
  const backmatter = boundaries.backmatter_start_block_id
    ? indexes.get(boundaries.backmatter_start_block_id)
    : undefined;
  const output: PresentedHeading[] = [];
  const counters = [0, 0, 0, 0];
  let baseLevel: number | undefined;
  let excludedLevel: number | undefined;
  for (const [index, { node }] of entries.entries()) {
    if (!("type" in node) || node.type !== "heading") continue;
    if (excludedLevel !== undefined && node.level <= excludedLevel)
      excludedLevel = undefined;
    if (node.exclude_from_numbering && excludedLevel === undefined)
      excludedLevel = node.level;
    const excluded = excludedLevel !== undefined;
    const role: ContentRole =
      backmatter !== undefined && index >= backmatter
        ? "backmatter"
        : appendix !== undefined && index >= appendix
          ? "appendix"
          : index < body
            ? "frontmatter"
            : "body";
    let number: string | null = null;
    if (!excluded && book.publishing.numbering === "source")
      number = node.source_number ?? null;
    if (
      !excluded &&
      role === "body" &&
      book.publishing.numbering === "generated"
    ) {
      baseLevel =
        baseLevel === undefined ? node.level : Math.min(baseLevel, node.level);
      const counterIndex = node.level - baseLevel;
      counters[counterIndex] = (counters[counterIndex] ?? 0) + 1;
      counters.fill(0, counterIndex + 1);
      number = counters.slice(0, counterIndex + 1).join(".");
    }
    const title = inlineText(node.content).trim();
    output.push({
      heading: node,
      role,
      number,
      title,
      label: [number, title].filter(Boolean).join(" "),
      numberingExcluded: excluded,
    });
  }
  return output;
}
