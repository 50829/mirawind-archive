import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiagnosticsPanel } from "@/web/components/manage/DiagnosticsPanel";

describe("workbench diagnostics", () => {
  it("renders typed locations and only non-adjudicating recoveries", () => {
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
            recovery: ["reload", "reprocess_verbatim"],
            severity: "warning",
          },
        ]}
        onActivate={() => undefined}
        onRecover={() => undefined}
        recoveryDisabled
      />,
    );

    expect(html).toContain("原 PDF 第 3 页");
    expect(html).toContain("源字节 20-40");
    expect(html).toContain("区域 region_abcdefghijklmnop");
    expect(html).toContain("定位");
    expect(html).toContain("重新载入");
    expect(html).toContain("按原文重新处理");
    expect(html).not.toContain("启用源区域");
    expect(html).toMatch(/disabled=""[^>]*>[^<]*(?:<[^>]+>)*按原文重新处理/u);
  });
});
