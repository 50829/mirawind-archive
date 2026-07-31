import type {
  NormalizedDocument,
  TransientDocumentNode,
} from "@/modules/publishing/core/preparation/document-model";
import type { ValidatedConfiguredHeading } from "@/modules/publishing/core/publication/validate-config";

export type HeadingNumberingMode = "generated" | "none" | "source";

export interface HeadingPresentation extends Omit<
  ValidatedConfiguredHeading,
  "display_title"
> {
  readonly display_title: string;
  readonly label: string;
  readonly number: string | null;
  readonly sourceNumber: string | null;
  readonly titleChildren: readonly TransientDocumentNode[];
}

interface SourceHeadingParts {
  readonly number: string | null;
  readonly prefixLength: number;
  readonly title: string;
}

const sourceNumberPatterns = [
  /^(?<number>第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部))(?<separator>[\s:：、.．。-]*)/u,
  /^(?<number>附录\s*[A-Za-z0-9一二三四五六七八九十]+(?:\.\d+){0,3})(?<separator>[\s:：、.．。-]*)/iu,
  /^(?<number>(?:chapter|part|appendix)\s+[A-Za-z0-9IVXLCDM一二三四五六七八九十]+(?:\.\d+){0,3})(?<separator>[\s:：、.．。-]*)/iu,
  /^(?<number>(?:[A-Z]\.\d+(?:\.\d+){0,2}|\d+\.\d+(?:\.\d+){0,2}))(?<separator>[\s:：、]*)(?=[\p{L}“”'"（(])/iu,
  /^(?<number>\d{1,3})(?<separator>\s+)(?=[\p{L}“”'"（(])/u,
] as const;

function sourceHeadingParts(value: string): SourceHeadingParts {
  for (const pattern of sourceNumberPatterns) {
    const match = pattern.exec(value);
    const number = match?.groups?.number;
    if (!match || !number) continue;
    const remaining = value.slice(match[0].length);
    const title = remaining.trimStart();
    return Object.freeze({
      number: number.trim().replaceAll(/\s+/gu, " "),
      prefixLength: match[0].length + remaining.length - title.length,
      title,
    });
  }
  return Object.freeze({ number: null, prefixLength: 0, title: value });
}

function leafText(node: TransientDocumentNode): string | undefined {
  if (
    node.type === "text" ||
    node.type === "inlineCode" ||
    node.type === "inlineMath"
  ) {
    return node.value ?? "";
  }
  return undefined;
}

function stripVisiblePrefix(
  nodes: readonly TransientDocumentNode[],
  length: number,
): readonly TransientDocumentNode[] | undefined {
  let remaining = length;
  const stripNode = (
    node: TransientDocumentNode,
  ): TransientDocumentNode | undefined => {
    const value = leafText(node);
    if (value !== undefined) {
      if (remaining >= value.length) {
        remaining -= value.length;
        return undefined;
      }
      if (remaining === 0) return node;
      const retained = value.slice(remaining);
      remaining = 0;
      return Object.freeze({ ...node, value: retained });
    }
    if (!node.children) return node;
    const children = node.children.flatMap((child) => {
      const stripped = stripNode(child);
      return stripped ? [stripped] : [];
    });
    if (children.length === 0) return undefined;
    return Object.freeze({ ...node, children: Object.freeze(children) });
  };
  const stripped = nodes.flatMap((node) => {
    const retained = stripNode(node);
    return retained ? [retained] : [];
  });
  return remaining === 0 ? Object.freeze(stripped) : undefined;
}

function appendixLetter(value: number): string {
  let current = value;
  let output = "";
  while (current > 0) {
    current -= 1;
    output = String.fromCodePoint(65 + (current % 26)) + output;
    current = Math.floor(current / 26);
  }
  return output;
}

function generatedNumbers(
  headings: readonly ValidatedConfiguredHeading[],
): readonly (string | null)[] {
  const bodyCounters = [0, 0, 0, 0];
  const appendixCounters = [0, 0, 0, 0];
  return Object.freeze(
    headings.map((heading) => {
      if (heading.role === "frontmatter" || heading.role === "backmatter") {
        return null;
      }
      const counters =
        heading.role === "appendix" ? appendixCounters : bodyCounters;
      const index = heading.display_level - 1;
      counters[index] = (counters[index] ?? 0) + 1;
      counters.fill(0, index + 1);
      const values = counters.slice(0, index + 1);
      return heading.role === "appendix"
        ? [appendixLetter(values[0] ?? 1), ...values.slice(1).map(String)].join(
            ".",
          )
        : values.map(String).join(".");
    }),
  );
}

export function presentConfiguredHeadings(input: {
  readonly document: NormalizedDocument;
  readonly headings: readonly ValidatedConfiguredHeading[];
  readonly mode: HeadingNumberingMode;
}): readonly HeadingPresentation[] {
  const generated = generatedNumbers(input.headings);
  const nodeByBlockId = new Map(
    input.document.blocks.flatMap((block) =>
      block.type === "heading" && block.blockId
        ? [[block.blockId, block] as const]
        : [],
    ),
  );
  return Object.freeze(
    input.headings.map((heading, index) => {
      const source = sourceHeadingParts(heading.source_title);
      const node = nodeByBlockId.get(heading.block_id);
      if (!node) throw new Error("HEADING_PRESENTATION_SOURCE_MISSING");
      const title = heading.display_title ?? source.title;
      const titleChildren =
        heading.display_title !== undefined
          ? Object.freeze([
              Object.freeze({ type: "text", value: heading.display_title }),
            ])
          : (stripVisiblePrefix(node.children ?? [], source.prefixLength) ??
            Object.freeze([Object.freeze({ type: "text", value: title })]));
      const generatedNumber = generated[index] ?? null;
      const number =
        input.mode === "none"
          ? null
          : input.mode === "source"
            ? source.number
            : heading.role === "appendix" && source.number
              ? source.number
              : generatedNumber;
      return Object.freeze({
        ...heading,
        display_title: title,
        label: [number, title].filter(Boolean).join(" "),
        number,
        sourceNumber: source.number,
        titleChildren,
      });
    }),
  );
}
