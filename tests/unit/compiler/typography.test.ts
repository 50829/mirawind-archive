import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  findTypographyProtectedRanges,
  preprocessMarkdownTypography,
} from "@/compiler/preprocess/typography";

const protectedTokensPath = fileURLToPath(
  new URL(
    "../../fixtures/mineru/synthetic/protected-tokens.md",
    import.meta.url,
  ),
);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("persisted Markdown typography preprocessing", () => {
  it("normalizes Han/Latin and Han/digit boundaries and Chinese punctuation", () => {
    const input =
      "# 中文English与数字42测试\n\n使用API,然后重试!这是第1章...结束.\n";
    const result = preprocessMarkdownTypography(input, "zh-smart-v1");
    expect(result.markdown).toBe(
      "# 中文 English 与数字 42 测试\n\n使用 API，然后重试！这是第 1 章……结束。\n",
    );
    expect(result.provenance).toMatchObject({
      input_sha256: sha256(input),
      output_sha256: sha256(result.markdown),
      profile: "zh-smart-v1",
    });
    expect(result.provenance.spaces_normalized).toBeGreaterThan(0);
    expect(result.provenance.punctuation_converted).toBeGreaterThan(0);
  });

  it("converts only confident paired punctuation and removes inner spaces", () => {
    const input =
      '他说: "中文 test" (示例),但保留 unmatched "quote 与 API(v1.2.3).\n';
    const result = preprocessMarkdownTypography(input, "zh-smart-v1");
    expect(result.markdown).toBe(
      '他说：“中文 test”（示例），但保留 unmatched "quote 与 API(v1.2.3).\n',
    );
  });

  it("protects code, math, URLs, email, paths, files, versions, times and numbers", () => {
    const input = [
      "中文v1.2.3中文 版本file.md中文 时间12:30中文 数值3.14中文",
      "",
      "邮箱a.b@example.com中文 路径/path/to/a,b.md中文 DOI 10.1000/xyz.1中文",
      "",
      "`中文API,3.14` $中文API,3.14$",
      "",
      "```ts",
      "const 中文API = 3.14;",
      "```",
      "",
    ].join("\n");
    const result = preprocessMarkdownTypography(input, "zh-smart-v1");
    expect(result.markdown).toContain("中文 v1.2.3 中文");
    expect(result.markdown).toContain("file.md 中文");
    expect(result.markdown).toContain("12:30 中文");
    expect(result.markdown).toContain("3.14 中文");
    expect(result.markdown).toContain("a.b@example.com 中文");
    expect(result.markdown).toContain("/path/to/a,b.md 中文");
    expect(result.markdown).toContain("10.1000/xyz.1 中文");
    expect(result.markdown).toContain("`中文API,3.14` $中文API,3.14$");
    expect(result.markdown).toContain("const 中文API = 3.14;");
    expect(result.provenance.protected_nodes).toBeGreaterThan(0);
  });

  it("reports exact non-overlapping protected byte ranges", () => {
    const input =
      "中文 `/资料/a,b.md` 与 $x=/公式/a.md$、[API](https://example.com/a,b) 和 --output=/资料/a.txt。\n";
    const bytes = Buffer.from(input, "utf8");
    const ranges = findTypographyProtectedRanges(input);
    const values = ranges.map((range) => ({
      kind: range.kind,
      value: bytes.subarray(range.start_byte, range.end_byte).toString("utf8"),
    }));

    expect(values).toEqual([
      { kind: "code", value: "`/资料/a,b.md`" },
      { kind: "formula", value: "$x=/公式/a.md$" },
      { kind: "link_destination", value: "https://example.com/a,b" },
      { kind: "command", value: "--output=/资料/a.txt。" },
    ]);
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]?.start_byte).toBeGreaterThanOrEqual(
        ranges[index - 1]?.end_byte ?? 0,
      );
    }
  });

  it("keeps Unicode paths and command arguments byte-identical", () => {
    const protectedValues = [
      "/资料/第1章/API,v1.2.3.md",
      "./目录/配置.json",
      "../源码/模块.ts",
      "--output=/资料/结果,a.txt",
      "--define=中文API,3.14",
      '--label="中文API,3.14"',
      "C:\\资料\\第1章\\配置.json",
    ];
    const input = `运行 ${protectedValues.join(" 再运行 ")} 完成.\n`;
    const result = preprocessMarkdownTypography(input, "zh-smart-v1");

    for (const value of protectedValues) {
      expect(Buffer.from(result.markdown).includes(Buffer.from(value))).toBe(
        true,
      );
    }
  });

  it("preserves the synthetic protected-token fixture", async () => {
    const input = await readFile(protectedTokensPath, "utf8");
    const result = preprocessMarkdownTypography(input, "zh-smart-v1");

    for (const token of [
      "/资料/第1章/API,v1.2.3.md",
      "./目录/配置.json",
      "--output=/资料/结果,a.txt",
      "--define=中文API,3.14",
      '--label="中文API,3.14"',
      "C:\\资料\\第1章\\配置.json",
      "$path=/资料/公式.md$",
      "https://example.com/a,b",
    ]) {
      expect(result.markdown).toContain(token);
    }
  });

  it("emits bounded locatable summaries without source content", () => {
    const input = `${Array.from(
      { length: 150 },
      () => "中文English,测试.",
    ).join("\n\n")}\n`;
    const result = preprocessMarkdownTypography(input, "zh-smart-v1");

    expect(result.riskSummaries).toHaveLength(100);
    expect(result.riskSummariesTruncated).toBe(true);
    for (const summary of result.riskSummaries) {
      expect(summary).toMatchObject({
        code: expect.stringMatching(/^TYPOGRAPHY_/u),
        end_byte: expect.any(Number),
        start_byte: expect.any(Number),
      });
      expect(summary.end_byte).toBeGreaterThan(summary.start_byte);
      expect(JSON.stringify(summary)).not.toContain("中文");
      expect(summary.end_byte).toBeLessThanOrEqual(Buffer.byteLength(input));
    }
  });

  it("handles transparent emphasis and link-label boundaries without changing destinations", () => {
    const input = "中文**English**中文与[API](https://example.com/a,b)中文\n";
    const result = preprocessMarkdownTypography(input, "zh-smart-v1");
    expect(result.markdown).toBe(
      "中文 **English** 中文与 [API](https://example.com/a,b) 中文\n",
    );
  });

  it("preserves line breaks and every non-target Markdown byte", () => {
    const input =
      '> 中文English  \n> 下一行\n\n![中文API](images/a,b.png "标题")\n';
    const result = preprocessMarkdownTypography(input, "zh-smart-v1");
    expect(result.markdown).toBe(
      '> 中文 English  \n> 下一行\n\n![中文API](images/a,b.png "标题")\n',
    );
  });

  it("is idempotent and verbatim-v1 is byte-identical", () => {
    const input = "\uFEFF# 中文English,第1章.\r\n";
    const first = preprocessMarkdownTypography(input, "zh-smart-v1");
    const second = preprocessMarkdownTypography(first.markdown, "zh-smart-v1");
    expect(second.markdown).toBe(first.markdown);
    expect(second.provenance.spaces_normalized).toBe(0);
    expect(second.provenance.punctuation_converted).toBe(0);

    const preserved = preprocessMarkdownTypography(input, "verbatim-v1");
    expect(preserved.markdown).toBe(input);
    expect(preserved.riskSummaries).toEqual([]);
    expect(preserved.riskSummariesTruncated).toBe(false);
    expect(preserved.provenance.input_sha256).toBe(
      preserved.provenance.output_sha256,
    );
  });
});
