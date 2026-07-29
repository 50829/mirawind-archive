import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { preprocessMarkdownTypography } from "@/modules/publishing/core/preparation/typography";

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const value = sorted[Math.floor(sorted.length / 2)];
  if (value === undefined) throw new Error("TYPOGRAPHY_MEASUREMENT_MISSING");
  return value;
}

function measureParagraphs(paragraphCount: number): number {
  const source = `${Array.from(
    { length: paragraphCount },
    (_, index) => `段落 ${index} 中文English,测试.`,
  ).join("\n\n")}\n`;
  const durations: number[] = [];
  preprocessMarkdownTypography(source, "zh-smart-v1");
  for (let repetition = 0; repetition < 3; repetition += 1) {
    const startedAt = performance.now();
    const result = preprocessMarkdownTypography(source, "zh-smart-v1");
    durations.push(performance.now() - startedAt);
    expect(result.provenance.spaces_normalized).toBe(paragraphCount);
    expect(result.provenance.punctuation_converted).toBe(paragraphCount * 2);
  }
  return median(durations);
}

describe("typography output builder", () => {
  it("keeps protected code, paths, formulas and technical tokens byte-identical", () => {
    const protectedValues = [
      "`const path = '/资料/API,v1.2.3.md'`",
      "$x=/公式/a,b.md$",
      "/资料/第1章/API,v1.2.3.md",
      "--output=/资料/结果,a.txt",
      "https://example.com/a,b",
    ];
    const source = `中文English,测试. ${protectedValues.join(" 中文English ")} 结束.\n`;
    const result = preprocessMarkdownTypography(source, "zh-smart-v1");

    for (const value of protectedValues) {
      expect(Buffer.from(result.markdown).includes(Buffer.from(value))).toBe(
        true,
      );
    }
  });

  it("reports exact UTF-8 ranges against the unmodified source", () => {
    const source = "前缀😀\n\n中文English,测试.\n\n尾部中文API,完成.\n";
    const sourceBytes = Buffer.from(source, "utf8");
    const result = preprocessMarkdownTypography(source, "zh-smart-v1");

    expect(result.riskSummaries).toHaveLength(2);
    expect(
      result.riskSummaries.map((summary) =>
        sourceBytes
          .subarray(summary.start_byte, summary.end_byte)
          .toString("utf8"),
      ),
    ).toEqual(["中文English,测试.", "尾部中文API,完成."]);
  });

  it("keeps fourfold edit growth below the sixfold scale gate", () => {
    const oneThousand = measureParagraphs(1_000);
    const fourThousand = measureParagraphs(4_000);

    expect(fourThousand / oneThousand).toBeLessThan(6);
  });
});
