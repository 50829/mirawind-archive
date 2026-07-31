import { parseHeadingMarkdown } from "@/modules/publishing/core/publication/heading-markdown";
import type { ValidatedConfiguredHeading } from "@/modules/publishing/core/publication/validate-config";

export type HeadingNumberingMode = "generated" | "none" | "source";

export interface HeadingPresentation extends ValidatedConfiguredHeading {
  readonly label: string;
  readonly number: string | null;
  readonly sourceNumber: string | null;
  readonly title: string;
  readonly titleChildren: ReturnType<typeof parseHeadingMarkdown>["children"];
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
