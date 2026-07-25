import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { preprocessMarkdownTypography } from "@/compiler/preprocess/typography";

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

  it("is idempotent and preserve-v1 is byte-identical", () => {
    const input = "\uFEFF# 中文English,第1章.\r\n";
    const first = preprocessMarkdownTypography(input, "zh-smart-v1");
    const second = preprocessMarkdownTypography(first.markdown, "zh-smart-v1");
    expect(second.markdown).toBe(first.markdown);
    expect(second.provenance.spaces_normalized).toBe(0);
    expect(second.provenance.punctuation_converted).toBe(0);

    const preserved = preprocessMarkdownTypography(input, "preserve-v1");
    expect(preserved.markdown).toBe(input);
    expect(preserved.provenance.input_sha256).toBe(
      preserved.provenance.output_sha256,
    );
  });
});
