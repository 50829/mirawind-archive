import { expect, type Page } from "@playwright/test";
import axe from "axe-core";

const axeSource = axe.source;

export async function expectNoSeriousAccessibilityFindings(page: Page) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const result = await (
      window as typeof window & {
        axe: {
          run: (
            context?: Document,
            options?: Readonly<Record<string, unknown>>,
          ) => Promise<{
            violations: readonly {
              impact: string | null;
              id: string;
              nodes: readonly { target: readonly string[] }[];
            }[];
          }>;
        };
      }
    ).axe.run(document, {
      resultTypes: ["violations"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
      },
    });
    return result.violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) => node.target),
      }));
  });
  expect(violations).toEqual([]);
}

export async function expectNoPageOverflow(page: Page) {
  const measurement = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    return {
      clientWidth,
      offenders: Array.from(document.body.querySelectorAll("*"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            className:
              typeof element.className === "string" ? element.className : "",
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            tagName: element.tagName.toLowerCase(),
            width: Math.round(rect.width),
          };
        })
        .filter(
          ({ left, right, width }) =>
            width > 0 && (left < -1 || right > clientWidth + 1),
        )
        .slice(0, 12),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(
    measurement.scrollWidth,
    `page overflow: ${JSON.stringify(measurement)}`,
  ).toBeLessThanOrEqual(measurement.clientWidth);
}
