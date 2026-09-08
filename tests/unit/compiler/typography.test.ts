import { describe, expect, it } from "vitest";
import { normalizeContentText } from "@/modules/publishing/core/preparation/typography";

describe("IR text typography", () => {
  it("normalizes mixed Chinese text and confident punctuation", () => {
    expect(
      normalizeContentText("使用API,然后重试!这是第1章...结束.").value,
    ).toBe("使用 API，然后重试！这是第 1 章……结束。");
    expect(
      normalizeContentText(
        '他说: "中文 test" (示例),但保留 unmatched "quote 与 API(v1.2.3).',
      ).value,
    ).toBe(
      '他说：“中文 test”（示例），但保留 unmatched "quote 与 API(v1.2.3).',
    );
  });
  it.each([
    "v1.2.3",
    "file.md",
    "12:30",
    "3.14",
    "a.b@example.com",
    "/path/to/a,b.md",
    "10.1000/xyz.1",
    "/资料/第1章/API,v1.2.3.md",
    "--output=/资料/结果,a.txt",
    '--label="中文API,3.14"',
  ])("preserves the technical token %s", (token) => {
    const result = normalizeContentText(`运行 ${token} 完成.`);
    expect(result.value).toContain(token);
    expect(normalizeContentText(result.value).value).toBe(result.value);
  });
});
