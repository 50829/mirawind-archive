import type { ValidatedConfiguredHeading } from "@/modules/publishing/core/publication/validate-config";

export interface NumberedHeading extends ValidatedConfiguredHeading {
  readonly number: string | null;
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

export function numberConfiguredHeadings(
  headings: readonly ValidatedConfiguredHeading[],
  mode: "normalized" | "preserve",
): readonly NumberedHeading[] {
  if (mode === "preserve") {
    return Object.freeze(
      headings.map((heading) => Object.freeze({ ...heading, number: null })),
    );
  }
  const bodyCounters = [0, 0, 0, 0];
  const appendixCounters = [0, 0, 0, 0];
  return Object.freeze(
    headings.map((heading) => {
      if (heading.role === "frontmatter" || heading.role === "backmatter") {
        return Object.freeze({ ...heading, number: null });
      }
      const counters =
        heading.role === "appendix" ? appendixCounters : bodyCounters;
      const index = heading.display_level - 1;
      counters[index] = (counters[index] ?? 0) + 1;
      counters.fill(0, index + 1);
      const values = counters.slice(0, index + 1);
      const number =
        heading.role === "appendix"
          ? [
              appendixLetter(values[0] ?? 1),
              ...values.slice(1).map(String),
            ].join(".")
          : values.map(String).join(".");
      return Object.freeze({ ...heading, number });
    }),
  );
}
