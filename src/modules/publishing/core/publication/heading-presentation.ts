import { parseHeadingMarkdown } from "./heading-markdown";
import type { ValidatedConfiguredHeading } from "./validate-config";

export type HeadingNumberingMode = "generated" | "none" | "source";

export interface HeadingPresentation extends ValidatedConfiguredHeading {
  readonly label: string;
  readonly number: string | null;
  readonly sourceNumber: string | null;
  readonly title: string;
  readonly titleChildren: ReturnType<typeof parseHeadingMarkdown>["children"];
}

function generatedNumbers(
  headings: readonly ValidatedConfiguredHeading[],
): readonly (string | null)[] {
  const counters = [0, 0, 0, 0];
  let baseLevel: number | null = null;
  return Object.freeze(
    headings.map((heading) => {
      if (heading.role !== "body") return null;
      if (baseLevel === null) baseLevel = heading.display_level;
      else if (heading.display_level < baseLevel) {
        baseLevel = heading.display_level;
      }
      const index = heading.display_level - baseLevel;
      counters[index] = (counters[index] ?? 0) + 1;
      counters.fill(0, index + 1);
      return counters
        .slice(0, index + 1)
        .map(String)
        .join(".");
    }),
  );
}

export function presentConfiguredHeadings(input: {
  readonly headings: readonly ValidatedConfiguredHeading[];
  readonly mode: HeadingNumberingMode;
}): readonly HeadingPresentation[] {
  const generated = generatedNumbers(input.headings);
  return Object.freeze(
    input.headings.map((heading, index) => {
      const parsed = parseHeadingMarkdown(heading.title_markdown);
      const sourceNumber = heading.source_number ?? null;
      const number =
        input.mode === "none"
          ? null
          : input.mode === "source"
            ? sourceNumber
            : (generated[index] ?? null);
      return Object.freeze({
        ...heading,
        label: [number, parsed.text].filter(Boolean).join(" "),
        number,
        sourceNumber,
        title: parsed.text,
        titleChildren: parsed.children,
      });
    }),
  );
}
