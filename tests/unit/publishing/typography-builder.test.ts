import { describe, expect, it } from "vitest";

import { preprocessMarkdownTypography } from "@/modules/publishing/core/preparation/typography";

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
    const result = preprocessMarkdownTypography(source, "zh-smart-v2");

    for (const value of protectedValues) {
      expect(Buffer.from(result.markdown).includes(Buffer.from(value))).toBe(
        true,
      );
    }
  });

  it("reports exact UTF-8 ranges against the unmodified source", () => {
    const source = "前缀😀\n\n中文English,测试.\n\n尾部中文API,完成.\n";
    const sourceBytes = Buffer.from(source, "utf8");
    const result = preprocessMarkdownTypography(source, "zh-smart-v2");

    expect(result.riskSummaries).toHaveLength(2);
    expect(
      result.riskSummaries.map((summary) =>
        sourceBytes
          .subarray(summary.start_byte, summary.end_byte)
          .toString("utf8"),
      ),
    ).toEqual(["中文English,测试.", "尾部中文API,完成."]);
  });
});
