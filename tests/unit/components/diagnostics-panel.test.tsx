import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiagnosticsPanel } from "@/web/components/manage/DiagnosticsPanel";

describe("workbench diagnostics", () => {
  it("does not render an action for informational evidence locations", () => {
    const html = renderToStaticMarkup(
      <DiagnosticsPanel
        diagnostics={[
          {
            code: "PDF_CONTENTS_OCR_LOW_CONFIDENCE",
            location: {
              endByte: 40,
              pageIndex: 2,
              regionId: "region_abcdefghijklmnop",
              startByte: 20,
            },
            message: "Bounded OCR evidence was insufficient.",
            phase: "ocr",
            severity: "warning",
          },
        ]}
        onTarget={() => undefined}
      />,
    );

    expect(html).toContain("原 PDF 第 3 页");
    expect(html).toContain("源字节 20-40");
    expect(html).toContain("区域 region_abcdefghijklmnop");
    expect(html).not.toContain("<button");
  });

  it("renders only explicit executable targets", () => {
    const html = renderToStaticMarkup(
      <DiagnosticsPanel
        diagnostics={[
          {
            code: "MATH_RENDER_FAILED",
            message: "The formula remains editable source.",
            targets: [
              {
                blockId: "blk_abcdefghijklmnop",
                kind: "edit_block",
                pageId: 3,
              },
              { kind: "reprocess_verbatim" },
            ],
          },
        ]}
        onTarget={() => undefined}
        reprocessDisabled
      />,
    );

    expect(html).toContain("编辑正文");
    expect(html).toContain("按原文重新处理");
    expect(html).toMatch(/disabled=""[^>]*>[^<]*(?:<[^>]+>)*按原文重新处理/u);
  });

  it("bounds the initial diagnostic DOM and reveals the remaining count", () => {
    const html = renderToStaticMarkup(
      <DiagnosticsPanel
        diagnostics={Array.from({ length: 25 }, (_value, index) => ({
          code: `TEST_DIAGNOSTIC_${index}`,
          message: `Diagnostic ${index}`,
        }))}
      />,
    );

    expect(html.match(/<li class=/gu)).toHaveLength(20);
    expect(html).toContain("显示 20 / 25");
    expect(html).toContain("再显示 5 条");
    expect(html).not.toContain("TEST_DIAGNOSTIC_24");
  });
});
