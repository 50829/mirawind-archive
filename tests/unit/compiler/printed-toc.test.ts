import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import {
  detectPrintedContents,
  hasReliableLayoutOrderInversion,
  inferPrintedHeadingEvidence,
  inferPrintedReferenceLevels,
  shouldPreferNativePdfDetection,
  supplementalPdfPageIndices,
  type PrintedContentsDetection,
} from "@/compiler/document/printed-toc";
import { applySourceRegions } from "@/compiler/document/source-regions";
import { proposeDocumentStructure } from "@/compiler/document/structure-proposal";

const fixturePath = fileURLToPath(
  new URL("../../fixtures/publishing-quality/printed-toc.md", import.meta.url),
);
const ambiguousPath = fileURLToPath(
  new URL(
    "../../fixtures/publishing-quality/ambiguous-toc.md",
    import.meta.url,
  ),
);
const allH2Path = fileURLToPath(
  new URL(
    "../../fixtures/mineru/synthetic/all-h2-nested-toc.md",
    import.meta.url,
  ),
);
const unlabelledPath = fileURLToPath(
  new URL("../../fixtures/mineru/synthetic/unlabelled-toc.md", import.meta.url),
);

function documentFor(source: string) {
  let ordinal = 0;
  return normalizeDocumentBlocks(parseMarkdownDocument(source), {
    idFactory: () => `blk_${String(++ordinal).padStart(16, "0")}`,
  });
}

describe("printed contents detection", () => {
  it("uses native PDF order only for a reliable sidecar inversion", () => {
    const records = [
      "第1章 开始 ...... 1",
      "第2章 结束 ...... 4",
      "1.1 第一节 ...... 2",
      "1.2 第二节 ...... 3",
    ].map((text, sourceOrder) => ({
      bbox: [20, 20 + sourceOrder * 30, 700, 40 + sourceOrder * 30] as const,
      pageIndex: 0,
      pageLabelSupplemented: true,
      sourceOrder,
      text,
      type: "text",
    }));
    const nativeRecords = [
      "第1章 开始 ...... 1",
      "1.1 第一节 ...... 2",
      "1.2 第二节 ...... 3",
      "第2章 结束 ...... 4",
    ].map((text, sourceOrder) => ({
      bbox: [20, 20 + sourceOrder * 30, 700, 40 + sourceOrder * 30] as const,
      pageIndex: 0,
      sourceOrder,
      text,
      type: "text",
    }));
    const source = {
      diagnostics: [],
      records,
      source: "content-list" as const,
    };

    expect(
      hasReliableLayoutOrderInversion(source, {
        diagnostics: [],
        records: nativeRecords,
        source: "native-pdf",
      }),
    ).toBe(true);
    expect(
      hasReliableLayoutOrderInversion(source, {
        diagnostics: [],
        records: records.map((record) => ({
          bbox: record.bbox,
          pageIndex: record.pageIndex,
          sourceOrder: record.sourceOrder,
          text: record.text,
          type: record.type,
        })),
        source: "native-pdf",
      }),
    ).toBe(false);
    expect(
      hasReliableLayoutOrderInversion(
        {
          ...source,
          records: nativeRecords.map((record) => ({
            ...record,
            pageLabelSupplemented: true,
          })),
        },
        {
          diagnostics: [],
          records,
          source: "native-pdf",
        },
      ),
    ).toBe(false);
  });

  it("prefers native PDF only for a significant complete-candidate advantage", () => {
    const detection = (
      entryCount: number,
      boundaryConfidence: "high" | "low" = "high",
    ) =>
      ({
        candidates: [
          {
            boundaryConfidence,
            entryCount,
            proposedRegion: {},
          },
        ],
      }) as unknown as PrintedContentsDetection;
    expect(shouldPreferNativePdfDetection(detection(10), detection(12))).toBe(
      false,
    );
    expect(shouldPreferNativePdfDetection(detection(10), detection(13))).toBe(
      true,
    );
    expect(
      shouldPreferNativePdfDetection(detection(10), detection(20, "low")),
    ).toBe(false);
  });

  it("matches decorative stars and equivalent technical math tokens", () => {
    const source = [
      "## Contents",
      "",
      "7.2.3 解释 ...... 305",
      "",
      "11.4 嵌入式选择与 $\\\\mathrm{L}1$ 正则化 ...... 395",
      "",
      "## 7.2.3 解释*",
      "",
      "Body",
      "",
      "## 11.4 嵌入式选择与 L_{1} 正则化",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map(
        (entry) => entry.bodyHeadingBlockId !== undefined,
      ),
    ).toEqual([true, true]);
  });

  it("preserves product-version numbers in major titles", () => {
    const source = [
      "## Contents",
      "",
      "Chapter 21 Windows  10",
      "",
      "21.1 History 821",
      "",
      "Chapter B Windows 7",
      "",
      "B.1 History 1",
      "",
      "## Chapter 21 Windows 10",
      "",
      "## 21.1 History",
      "",
      "## Chapter B Windows 7",
      "",
      "## B.1 History",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual([
      "Chapter 21 Windows  10",
      "21.1 History 821",
      "Chapter B Windows 7",
      "B.1 History 1",
    ]);
  });

  it("recognizes bare chapter numbers, alphanumeric sections and local appendices", () => {
    expect(inferPrintedHeadingEvidence("1 导论")).toMatchObject({
      kind: "chapter",
      key: "1",
      level: 1,
    });
    expect(inferPrintedHeadingEvidence("1A Rn 和 Cn")).toMatchObject({
      kind: "decimal",
      key: "1a",
      level: 2,
    });
    expect(inferPrintedHeadingEvidence("3A.1 OLS 系数推导")).toMatchObject({
      kind: "decimal",
      key: "3a.1",
      level: 3,
    });
    expect(inferPrintedHeadingEvidence("A.2 Early Systems")).toMatchObject({
      kind: "decimal",
      key: "a.2",
      level: 2,
    });
    expect(inferPrintedHeadingEvidence("PART ONE OVERVIEW")).toMatchObject({
      kind: "part",
      level: 1,
    });
    expect(inferPrintedHeadingEvidence("Chapter")).toBeUndefined();
    expect(inferPrintedHeadingEvidence("CHAPTER OBJECTIVES")).toBeUndefined();
    expect(inferPrintedHeadingEvidence("Part I—Assignment")).toMatchObject({
      kind: "part",
      level: 1,
    });
    expect(inferPrintedHeadingEvidence("\\ 4.6 证明主定理")).toMatchObject({
      kind: "decimal",
      level: 2,
    });
    expect(inferPrintedHeadingEvidence("\\* 5.4 概率分析")).toMatchObject({
      kind: "decimal",
      level: 2,
    });
    expect(inferPrintedHeadingEvidence("B. 3 函数")).toMatchObject({
      kind: "decimal",
      level: 2,
    });
    expect(
      inferPrintedReferenceLevels([
        "PART ONE OVERVIEW",
        "Chapter 1 Introduction",
        "1.1 What Operating Systems Do",
      ]),
    ).toEqual([1, 2, 3]);
    expect(
      inferPrintedReferenceLevels([
        "PART ONE OVERVIEW",
        "Chapter 1 Introduction",
        "1.1 What Operating Systems Do",
        "Bibliography",
        "Chapter 2 Structures",
      ]),
    ).toEqual([1, 2, 3, 3, 2]);
    expect(
      inferPrintedReferenceLevels([
        "Chapter 16 Learning",
        "16.1 Training",
        "References",
        "Appendix A Data",
      ]),
    ).toEqual([1, 2, 2, 1]);
    expect(
      inferPrintedReferenceLevels(["附录", "A 矩阵", "B 优化", "后记"]),
    ).toEqual([1, 2, 2, 1]);
    expect(inferPrintedHeadingEvidence("附录 4.2 因子模型")).toMatchObject({
      kind: "appendix",
      level: 2,
    });
    expect(
      inferPrintedReferenceLevels([
        "4 对经典线性回归模型的进一步探讨",
        "4.11 分位数回归",
        "附录 4.1 数学推导",
        "附录:补充证明",
        "5 经典线性回归模型的假设",
        "附录 1 数据来源",
      ]),
    ).toEqual([1, 2, 2, 2, 1, 1]);
  });

  it("keeps appendix notes and nested appendices in their structural context", () => {
    expect(inferPrintedHeadingEvidence("附录注记")).toBeUndefined();
    expect(
      inferPrintedReferenceLevels([
        "第八部分 附录:数学基础知识",
        "附录 A 求和",
        "A.1 求和公式及其性质",
        "附录注记",
        "附录 B 集合等离散数学内容",
        "B.1 集合",
      ]),
    ).toEqual([1, 2, 3, 3, 2, 3]);
    expect(
      inferPrintedReferenceLevels([
        "第二部分 资产组合理论",
        "第6章 风险资产配置",
        "6.1 风险与风险厌恶",
        "6.1.1 效用函数",
        "思考题",
        "本章注记",
        "附录 6A 风险厌恶",
        "附录 6B 效用函数",
        "第7章 最优风险资产组合",
        "7.1 分散化与组合风险",
      ]),
    ).toEqual([1, 2, 3, 4, 3, 3, 3, 3, 2, 3]);
  });

  it("keeps a compact appendix exercise label inside its chapter", () => {
    expect(
      inferPrintedReferenceLevels([
        "第二部分 资产组合理论与实践",
        "第6章 风险资产配置",
        "6.1 风险与收益",
        "附录 6A 风险厌恶",
        "附录6A习题",
        "附录 6B 保险合同",
      ]),
    ).toEqual([1, 2, 3, 3, 3, 3]);

    expect(
      inferPrintedReferenceLevels(
        [
          "第二部分 资产组合理论与实践",
          "第6章 风险资产配置",
          "6.1 风险与收益",
          "附录 6A 风险厌恶",
          "概念检查6A-1",
          "附录6A习题",
          "附录 6B 保险合同",
        ],
        {
          referenceLevels: new Map([
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 3],
            [6, 3],
          ]),
        },
      ),
    ).toEqual([1, 2, 3, 3, 3, 3, 3]);
  });

  it("keeps unnumbered topics inside an alphanumeric section", () => {
    expect(
      inferPrintedReferenceLevels(
        [
          "第2章 线性映射",
          "2A 张成空间和线性无关性",
          "线性组合和张成空间",
          "线性无关性",
          "习题 2A",
          "2B 基",
          "基的判定",
          "习题 2B",
          "第3章 多项式",
        ],
        {
          referenceLevels: new Map([
            [2, 2],
            [3, 2],
            [4, 2],
            [6, 2],
            [7, 2],
          ]),
        },
      ),
    ).toEqual([1, 2, 3, 3, 3, 2, 3, 3, 1]);
  });

  it("produces a high-confidence title-free region with monotonic body matches", async () => {
    const source = await readFile(fixturePath, "utf8");
    const digest = createHash("sha256").update(source).digest("hex");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: digest,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      confidence: "high",
      entryCount: 6,
      matchedHeadingCount: 6,
      proposedRegion: {
        applied: true,
        disposition: "reference_only",
        entries: expect.arrayContaining([
          expect.objectContaining({
            body_heading_block_id: expect.stringMatching(/^blk_/u),
            reference_level: 1,
          }),
          expect.objectContaining({ reference_level: 2 }),
        ]),
        kind: "printed_toc",
        region_id: "region_abcdefghijklmnop",
        source_path: "source/full.md",
        source_sha256: digest,
      },
    });
    expect(JSON.stringify(result.candidates[0]?.proposedRegion)).not.toContain(
      "绪论",
    );
    expect(result.candidates[0]?.proposedRegion?.range.start_byte).toBe(
      Buffer.byteLength(source.slice(0, source.indexOf("# 目录")), "utf8"),
    );
  });

  it("excludes a reliable region while leaving repeated matches ambiguous", async () => {
    const source = await readFile(ambiguousPath, "utf8");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });
    expect(result.candidates[0]).toMatchObject({
      boundaryConfidence: "high",
      matchConfidence: expect.not.stringMatching(/^high$/u),
      proposedRegion: expect.objectContaining({ applied: true }),
    });
    expect(result.candidates[0]?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PRINTED_TOC_AMBIGUOUS_MATCH" }),
    );
  });

  it("does not suppress an ordinary chapter named 目录", () => {
    const source = "# 目录\n\n这里介绍目录设计而不是纸质目录。\n\n# 正文\n";
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });
    expect(
      result.candidates.every((candidate) => !candidate.proposedRegion),
    ).toBe(true);
  });

  it("applies a high-confidence boundary that contains a scanned contents image", () => {
    const source = [
      "# 目录",
      "",
      "# 第一章 甲 ...... 1",
      "",
      "![scan](images/toc.png)",
      "",
      "# 第二章 乙 ...... 2",
      "",
      "# 第三章 丙 ...... 3",
      "",
      "# 第一章 甲",
      "",
      "# 第二章 乙",
      "",
      "# 第三章 丙",
      "",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });
    expect(result.candidates[0]?.proposedRegion).toMatchObject({
      applied: true,
      disposition: "reference_only",
    });
    expect(result.candidates[0]?.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "PRINTED_TOC_RICH_CONTENT" }),
    );
  });

  it("does not promote arbitrary short prose inside a labelled contents", () => {
    const source = [
      "# Contents",
      "",
      "Editorial overview",
      "",
      "Bibliographic Notes . . . . .",
      "",
      "# Chapter 1 Start .... 1",
      "",
      "# Chapter 2 Continue .... 9",
      "",
      "# Chapter 3 Finish .... 17",
      "",
      "习题 19",
      "",
      "Fn 20",
      "",
      "# Chapter 1 Start",
      "",
      "Body",
      "",
      "# Chapter 2 Continue",
      "",
      "Body",
      "",
      "# Chapter 3 Finish",
      "",
      "Body",
      "",
      "# 习题",
      "",
      "Body",
      "",
      "# Fn",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]).toMatchObject({
      entryCount: 5,
      matchedHeadingCount: 5,
    });
  });

  it("drops unresolved dotted local rows while keeping labelled neighbors", () => {
    const source = [
      "# Contents",
      "",
      "## 2 Overview ...... 9",
      "",
      "Bibliographic Notes . . . . .",
      "",
      "Exercises . . . . . 39",
      "",
      "## 3 Regression ...... 43",
      "",
      "## 2 Overview",
      "",
      "Body",
      "",
      "## Bibliographic Notes",
      "",
      "Body",
      "",
      "## Exercises",
      "",
      "Body",
      "",
      "## 3 Regression",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) =>
        entry.sourceTitle.replace(/^#{1,6}\s+/u, ""),
      ),
    ).toEqual([
      "2 Overview ...... 9",
      "Exercises . . . . . 39",
      "3 Regression ...... 43",
    ]);
  });

  it("merges a wrapped chapter title split across adjacent Markdown headings", () => {
    const source = [
      "# Contents",
      "",
      "## 11 Neural Networks ...... 389",
      "",
      "## 12 Support Vector Machines and",
      "",
      "## Flexible Discriminants 417",
      "",
      "## 12.1 Introduction ...... 417",
      "",
      "## 13 Prototype Methods ...... 459",
      "",
      "## 11 Neural Networks",
      "",
      "Body",
      "",
      "## 12 Support Vector Machines and Flexible Discriminants",
      "",
      "Body",
      "",
      "## 12.1 Introduction",
      "",
      "Body",
      "",
      "## 13 Prototype Methods",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) =>
        entry.sourceTitle.replace(/^#{1,6}\s+/u, ""),
      ),
    ).toContain("12 Support Vector Machines and Flexible Discriminants 417");
    expect(
      result.candidates[0]?.logicalEntries.some((entry) =>
        entry.sourceTitle.includes("## Flexible Discriminants"),
      ),
    ).toBe(false);
  });

  it("does not merge an alpha section with its child when its leader lacks a page", () => {
    const source = [
      "# 目录",
      "",
      "5A 不变子空间 ...... 112",
      "",
      "5B 最小多项式 . . . . . .",
      "",
      "复向量空间上特征值的存在性 . . . . . . 120",
      "",
      "5C 上三角矩阵 ...... 129",
      "",
      "## 5A 不变子空间",
      "",
      "## 5B 最小多项式",
      "",
      "## 复向量空间上特征值的存在性",
      "",
      "## 5C 上三角矩阵",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual([
      "5A 不变子空间 ...... 112",
      "5B 最小多项式 . . . . . .",
      "复向量空间上特征值的存在性 . . . . . . 120",
      "5C 上三角矩阵 ...... 129",
    ]);
  });

  it("bridges a bounded run of non-entry blocks inside printed contents", () => {
    const source = [
      "# Contents",
      "",
      "# Chapter 1 Start .... 1",
      "",
      "![scan](images/contents.png)",
      "",
      "Page header.",
      "",
      "Copyright notice.",
      "",
      "Column marker.",
      "",
      "Continued on next page.",
      "",
      "# Chapter 2 Continue .... 9",
      "",
      "# Chapter 3 Finish .... 17",
      "",
      "# Chapter 1 Start",
      "",
      "Body",
      "",
      "# Chapter 2 Continue",
      "",
      "Body",
      "",
      "# Chapter 3 Finish",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]).toMatchObject({
      boundaryConfidence: "high",
      entryCount: 3,
      proposedRegion: expect.objectContaining({ applied: true }),
    });
  });

  it("stops before a following list of figures or tables", () => {
    const source = [
      "# Contents",
      "",
      "# Chapter 1 Start 1",
      "",
      "# Chapter 2 Continue 9",
      "",
      "# Chapter 3 Finish 17",
      "",
      "# List of Figures",
      "",
      "Figure 1 Overview 5",
      "",
      "Figure 2 Detail 7",
      "",
      "# List of Tables",
      "",
      "Table 1 Results 8",
      "",
      "# Chapter 1 Start",
      "",
      "Body",
      "",
      "# Chapter 2 Continue",
      "",
      "Body",
      "",
      "# Chapter 3 Finish",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]).toMatchObject({ entryCount: 3 });
    expect(result.candidates[0]?.endByte).toBe(
      Buffer.byteLength(
        "# Contents\n\n# Chapter 1 Start 1\n\n# Chapter 2 Continue 9\n\n# Chapter 3 Finish 17",
        "utf8",
      ),
    );
  });

  it("keeps a repeated chapter when printed-page rows continue after it", () => {
    const source = [
      "# Contents",
      "",
      "# Chapter 1 Start 1",
      "",
      "# Chapter 2 Continue 9",
      "",
      "# Chapter 1 Start",
      "",
      "1.1 Basics 1",
      "",
      "1.2 More 3",
      "",
      "# Chapter 2 Continue",
      "",
      "2.1 Detail 9",
      "",
      "2.2 Finish 12",
      "",
      "# Chapter 1 Start",
      "",
      "Body paragraph.",
      "",
      "# 1.1 Basics",
      "",
      "Body paragraph.",
      "",
      "# Chapter 2 Continue",
      "",
      "Body paragraph.",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]).toMatchObject({
      entryCount: 8,
      proposedRegion: expect.objectContaining({ applied: true }),
    });
  });

  it("recovers nested printed levels when MinerU emits every heading as H2", async () => {
    const source = await readFile(allH2Path, "utf8");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.proposedRegion?.entries.map(
        (entry) => entry.reference_level,
      ),
    ).toEqual([1, 2, 2]);
    expect(
      result.candidates[0]?.proposedRegion?.entries.every(
        (entry) => entry.body_heading_block_id,
      ),
    ).toBe(true);
  });

  it("recovers an OCR-damaged printed title from a unique matching body number", () => {
    const source = [
      "## Contents",
      "",
      "## 1.1.1 具体构成描述 ...... 2",
      "",
      "## 1.1.2 务 ...... 4",
      "",
      "## 1.1.3 什么是协议 ...... 6",
      "",
      "## 1.1.1 具体构成描述",
      "",
      "Body",
      "",
      "## 1.1.2 服务描述",
      "",
      "Body",
      "",
      "## 1.1.3 什么是协议",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]).toMatchObject({
      bodyHeadingBlockId: expect.stringMatching(/^blk_/u),
      sourceTitle: expect.stringContaining("1.1.2 服务描述"),
    });
  });

  it("repairs spaced body decimal numbering while recovering a damaged printed title", () => {
    const source = [
      "## Contents",
      "",
      "## 1.1.1 具体构成描述 ...... 2",
      "",
      "## 1.1.2 务 ...... 4",
      "",
      "## 1.1.3 什么是协议 ...... 6",
      "",
      "## 1. 1. 1 具体构成描述",
      "",
      "Body",
      "",
      "## 1. 1. 2 服务描述",
      "",
      "Body",
      "",
      "## 1. 1. 3 什么是协议",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]).toMatchObject({
      bodyHeadingBlockId: expect.stringMatching(/^blk_/u),
      sourceTitle: "1.1.2 服务描述 ...... 4",
    });
  });

  it("repairs multi-character OCR loss from a unique numbered body heading", () => {
    const source = [
      "## Contents",
      "",
      "## 2.3.2 邮件报文格式 ...... 79",
      "",
      "## 2.3.3 邮件 协 ...... 80",
      "",
      "## 2.4 DNS 服务 ...... 81",
      "",
      "## 2.3.2 邮件报文格式",
      "",
      "Body",
      "",
      "## 2.3.3 邮件访问协议",
      "",
      "Body",
      "",
      "## 2.4 DNS 服务",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]).toMatchObject({
      bodyHeadingBlockId: expect.stringMatching(/^blk_/u),
      sourceTitle: expect.stringContaining("2.3.3 邮件访问协议"),
    });
  });

  it("repairs a known OCR phrase corruption from the numbered body heading", () => {
    const source = [
      "## Contents",
      "",
      "## 1.1.2 服务描述 ...... 4",
      "",
      "## 1.1.3 仕么是协议 ...... 5",
      "",
      "## 1.2 网络边缘 ...... 6",
      "",
      "## 1.1.2 服务描述",
      "",
      "## 1.1.3 什么是协议",
      "",
      "## 1.2 网络边缘",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]?.sourceTitle).toContain(
      "1.1.3 什么是协议",
    );
  });

  it("repairs an unnumbered damaged row only inside reliable neighbor anchors", () => {
    const source = [
      "## Contents",
      "",
      "## 7.4.6 5G 蜂窝网络 ...... 378",
      "",
      "## 移动 管 ...... 380",
      "",
      "## 7.5.1 设备移动性 ...... 381",
      "",
      "## 7.4.6 5G 蜂窝网络",
      "",
      "Body",
      "",
      "## 7.5 移动性管理原理",
      "",
      "Body",
      "",
      "## 7.5.1 设备移动性",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]).toMatchObject({
      bodyHeadingBlockId: expect.stringMatching(/^blk_/u),
      sourceTitle: expect.stringContaining("7.5 移动性管理原理"),
    });
  });

  it("recovers a page-only row inside a chapter review group", () => {
    const source = [
      "## Contents",
      "",
      "## 3.9 小结 ...... 186",
      "",
      "## 课后习题和问题 ...... 187",
      "",
      "## 复习题 ...... 187",
      "",
      "## ...... 189",
      "",
      "## 编程作业 ...... 196",
      "",
      "## 第 4 章 下一章 ...... 198",
      "",
      "## 3.9 小结",
      "",
      "## 课后习题和问题",
      "",
      "## 复习题",
      "",
      "## 习题",
      "",
      "## 编程作业",
      "",
      "## 第 4 章 下一章",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => ({
        matched: Boolean(entry.bodyHeadingBlockId),
        title: entry.sourceTitle,
      })),
    ).toContainEqual({ matched: true, title: "习题...... 189" });
  });

  it("recomputes nested levels after recovering a matched title", () => {
    const source = [
      "## Contents",
      "",
      "第七部分 专题 ...... 700",
      "",
      "第35章 近似算法 ...... 701",
      "",
      "35.2 旅行商问题 ...... 710",
      "",
      "35.2.1 題 ...... 711",
      "",
      "## 第七部分 专题",
      "",
      "## 第35章 近似算法",
      "",
      "## 35.2 旅行商问题",
      "",
      "## 35.2.1 满足三角不等式的旅行商问题",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.referenceLevel),
    ).toEqual([1, 2, 3, 4]);
  });

  it("uses page-stripped semantics for final chapter notes and appendices", () => {
    expect(
      inferPrintedReferenceLevels([
        "第 16 章 强化学习 ...... 370",
        "16.7 阅读材料 ...... 393",
        "习题 ...... 394",
        "参考文献 ...... 395",
        "附录 ...... 399",
        "A 矩阵 ...... 399",
        "后记 ...... 417",
      ]),
    ).toEqual([1, 2, 2, 2, 1, 2, 1]);
  });

  it("returns chapter notes to the canonical section level", () => {
    expect(
      inferPrintedReferenceLevels([
        "Chapter 1 Start ...... 1",
        "1.1 Topic ...... 2",
        "1.1.1 Detail ...... 3",
        "Bibliographic Notes ...... 4",
        "Exercises ...... 5",
        "Chapter 2 Continue ...... 6",
      ]),
    ).toEqual([1, 2, 3, 2, 2, 1]);
    expect(
      inferPrintedReferenceLevels([
        "Part One Foundations",
        "Chapter 1 Start ...... 1",
        "1.1 Topic ...... 2",
        "1.1.1 Detail ...... 3",
        "Bibliography ...... 4",
        "Chapter 2 Continue ...... 6",
      ]),
    ).toEqual([1, 2, 3, 4, 3, 2]);
  });

  it("preserves a reliable short printed title instead of rewriting it from the body", () => {
    const source = [
      "## Contents",
      "",
      "10.2.1 Previous ...... 409",
      "",
      "10.2.2 庞加菜怎样看指数 ...... 410",
      "",
      "10.2.3 Next ...... 411",
      "",
      "## 10.2.1 Previous",
      "",
      "Body",
      "",
      "## 10.2.2 庞加莱怎样看指数",
      "",
      "Body",
      "",
      "## 10.2.3 Next",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]?.sourceTitle).toContain(
      "庞加菜怎样看指数",
    );
  });

  it("does not copy renderer artifacts from a matched body heading", () => {
    const source = [
      "## Contents",
      "",
      "5A 不变子空间 ...... 155",
      "",
      "习题 5A ...... 167",
      "",
      "5B 最小多项式 ...... 168",
      "",
      "## 5A 不变子空间",
      "",
      "## $K$ 习题 5A $k$",
      "",
      "## 5B 最小多项式 . . . . 复向量空间上特征值的存在性",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual([
      expect.stringContaining("5A 不变子空间"),
      expect.stringContaining("习题 5A ...... 167"),
      expect.stringContaining("5B 最小多项式 ...... 168"),
    ]);
  });

  it("withholds bilingual body matches when numbering is the only strong evidence", () => {
    const source = [
      "## Contents",
      "",
      "1.1 河内塔 ...... 1",
      "",
      "1.2 平面上的直线 ...... 4",
      "",
      "1.3 约瑟夫问题 ...... 7",
      "",
      "## 1.1 河内塔 THE TOWER OF HANOI",
      "",
      "Body",
      "",
      "## 1.2 平面上的直线 LINES IN THE PLANE",
      "",
      "Body",
      "",
      "## 1.3 约瑟夫问题 THE JOSEPHUS PROBLEM",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });
    const candidate = result.candidates[0];

    expect(candidate?.logicalEntries).toHaveLength(3);
    expect(
      candidate?.logicalEntries.map((entry) => entry.bodyHeadingBlockId),
    ).toEqual([undefined, undefined, undefined]);
    expect(
      candidate?.diagnostics.filter(
        (diagnostic) => diagnostic.code === "PRINTED_TOC_UNMATCHED_ENTRY",
      ),
    ).toHaveLength(3);
  });

  it("normalizes bounded TeX display artifacts in printed rows", () => {
    const source = [
      "## Contents",
      "",
      "2.3.3 用多项式逼近幂级数 $\\dots 59$",
      "",
      "4.8.1 引言 ^{1} ...... 182",
      "",
      "5.8 E^{\\prime} = E 的几何解法 ...... 206",
      "",
      "## 2.3.3 用多项式逼近幂级数",
      "",
      "Body",
      "",
      "## 4.8.1 引言 ^{1}",
      "",
      "Body",
      "",
      "## 5.8 E' = E 的几何解法",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual([
      "2.3.3 用多项式逼近幂级数 \\dots 59",
      "4.8.1 引言 ...... 182",
      "5.8 E' = E 的几何解法 ...... 206",
    ]);
  });

  it("keeps an appendix letter with its following title", () => {
    const source = [
      "## Contents",
      "",
      "Appendix B References ...... 508",
      "",
      "Appendix C Credits for Exercises ...... 536",
      "",
      "Index ...... 543",
      "",
      "## Appendix B References",
      "",
      "Body",
      "",
      "## Appendix C Credits for Exercises",
      "",
      "Body",
      "",
      "## Index",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual([
      "Appendix B References ...... 508",
      "Appendix C Credits for Exercises ...... 536",
      "Index ...... 543",
    ]);
  });

  it("does not insert an unnumbered PDF fragment between reliable numbered rows", () => {
    const source = [
      "## Contents",
      "",
      "7.4 一个拓扑辐角原理 ...... 307",
      "",
      "7.4.5 两个例子 ...... 312",
      "",
      "7.5 鲁歇定理 ...... 314",
      "",
      "7.5.1 结果 ...... 314",
      "",
      "7.6 最大值与最小值 ...... 316",
      "",
      "## 7.4.5 两个例子",
      "",
      "Body",
      "",
      "## 7.5 鲁歇定理",
      "",
      "Body",
      "",
      "## 7.5.1 结果",
      "",
      "Body",
      "",
      "## 7.6 最大值与最小值",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: [
          "7.4 一个拓扑辐角原理 ...... 307",
          "7.4.5 两个例子 ...... 312",
          "* ...... 鲁歇定理 ...... 314",
          "7.5.1 结果 ...... 314",
          "7.6 最大值与最小值 ...... 316",
        ].map((text, index) => ({
          bbox: [20, 20 + index * 30, 700, 40 + index * 30] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.referenceLevel),
    ).toEqual([1, 2, 2, 3, 2]);
  });

  it("nests chapters below parts while keeping earlier chapters and appendices at the top level", () => {
    const contents = [
      "第 1 章 计算机系统漫游 ...... 1",
      "1.1 信息就是位加上下文 ...... 2",
      "第一部分 程序结构和执行 ...... 35",
      "第 2 章 信息的表示和处理 ...... 36",
      "2.1 信息存储 ...... 37",
      "2.1.1 十六进制表示 ...... 40",
      "第二部分 在系统上运行程序 ...... 300",
      "第 7 章 链接 ...... 301",
      "7.1 编译器驱动程序 ...... 302",
      "附录 A 错误处理 ...... 700",
    ];
    const body = contents.map((entry) =>
      entry.replace(/\s+\.{2,}\s+\d+$/u, ""),
    );
    const source = [
      "## 目录",
      "",
      ...contents.flatMap((entry) => [`## ${entry}`, ""]),
      ...body.flatMap((entry) => [`## ${entry}`, "", "正文", ""]),
    ].join("\n");
    const document = documentFor(source);
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const misleadingLayoutTitles = [
      contents[0],
      contents[1],
      contents[3],
      contents[4],
      contents[2],
    ].filter((title): title is string => title !== undefined);
    if (misleadingLayoutTitles.length !== 5) {
      throw new Error("Test contents are incomplete");
    }

    const result = detectPrintedContents({
      document,
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: [
          {
            bbox: [20, 10, 200, 30],
            pageIndex: 0,
            text: "目录",
            type: "text",
          },
          ...misleadingLayoutTitles.map((text, index) => ({
            bbox: [20, 40 + index * 30, 800, 60 + index * 30] as const,
            pageIndex: 0,
            text,
            type: "text",
          })),
        ],
        source: "content-list",
      },
      sourcePath: "source/full.md",
      sourceSha256,
    });

    const region = result.candidates[0]?.proposedRegion;
    expect(region?.entries.map((entry) => entry.reference_level)).toEqual([
      1, 2, 1, 2, 3, 4, 1, 2, 3, 1,
    ]);
    expect(region).toBeDefined();
    if (!region) throw new Error("Expected a proposed printed region");

    const activeDocument = applySourceRegions({
      document,
      mainMarkdownPath: "source/full.md",
      mainMarkdownSha256: sourceSha256,
      regions: [region],
    }).document;
    expect(
      activeDocument.headings.filter((heading) =>
        heading.sourceTitle.includes("第一部分"),
      ),
    ).toHaveLength(1);
    expect(
      activeDocument.headings.some((heading) =>
        /\.{2,}\s*35$/u.test(heading.sourceTitle),
      ),
    ).toBe(false);
    const proposal = proposeDocumentStructure(activeDocument, {
      sourceRegions: [region],
    });
    const levels = new Map(
      proposal.nodes.map((node) => [node.block_id, node.display_level]),
    );
    const levelForTitle = (title: string) => {
      const heading = activeDocument.headings.find(
        (candidate) => candidate.sourceTitle === title,
      );
      return heading ? levels.get(heading.blockId) : undefined;
    };
    expect(levelForTitle("第一部分 程序结构和执行")).toBe(1);
    expect(levelForTitle("第 2 章 信息的表示和处理")).toBe(2);
  });

  it("uses local indentation for unnumbered printed entries", () => {
    const contents = [
      "第 1 章 导论 ...... 1",
      "1.1 基础 ...... 2",
      "1.1.1 细节 ...... 3",
      "课后习题和问题 ...... 8",
      "复习题 ...... 8",
      "Wireshark 实验 ...... 9",
    ];
    const body = contents.map((entry) =>
      entry.replace(/\s+\.{2,}\s+\d+$/u, ""),
    );
    const source = [
      "## 目录",
      "",
      ...contents.flatMap((entry) => [`## ${entry}`, ""]),
      ...body.flatMap((entry) => [`## ${entry}`, "", "正文", ""]),
    ].join("\n");
    const indents = [20, 30, 40, 30, 40, 30];
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: contents.map((text, index) => ({
          bbox: [
            indents[index] ?? 20,
            20 + index * 30,
            500,
            40 + index * 30,
          ] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.proposedRegion?.entries.map(
        (entry) => entry.reference_level,
      ),
    ).toEqual([1, 2, 3, 2, 3, 3]);
  });

  it("recovers layout-only logical entries between reliable Markdown anchors", () => {
    const markdownEntries = [
      "Chapter 1 Start ...... 1",
      "1.1 Basics ...... 2",
      "评 .................................... 44",
      "Chapter 2 Continue ...... 53",
    ];
    const layoutEntries = [
      "Chapter 1 Start ...... 1",
      "1.1 Basics ...... 2",
      "课后习题和问题 ...... 44",
      "复习题 ...... 44",
      "习题 ...... 46",
      "Chapter 2 Continue ...... 53",
    ];
    const bodyEntries = layoutEntries.map((entry) =>
      entry.replace(/\s+\.{2,}\s+\d+$/u, ""),
    );
    const source = [
      "# Contents",
      "",
      ...markdownEntries.flatMap((entry) => [`## ${entry}`, ""]),
      ...bodyEntries.flatMap((entry) => [`## ${entry}`, "", "Body", ""]),
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: layoutEntries.map((text, index) => ({
          bbox: [
            index === 0 || index === layoutEntries.length - 1 ? 20 : 40,
            20 + index * 30,
            700,
            40 + index * 30,
          ] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    const candidate = result.candidates[0];
    expect(candidate?.logicalEntries.map((entry) => entry.sourceTitle)).toEqual(
      layoutEntries,
    );
    expect(candidate).toMatchObject({
      entryCount: 6,
      matchedHeadingCount: 6,
    });
    expect(candidate?.proposedRegion?.entries.length).toBeGreaterThanOrEqual(3);
    expect(
      new Set(
        candidate?.proposedRegion?.entries.map(
          (entry) => `${entry.range.start_byte}:${entry.range.end_byte}`,
        ),
      ).size,
    ).toBe(candidate?.proposedRegion?.entries.length);
  });

  it("recovers unnumbered native rows from an empty source gap", () => {
    const markdownEntries = [
      "第 1 章 向量空间 ...... 1",
      "1A 向量 ...... 2",
      "第 2 章 线性映射 ...... 20",
    ];
    const layoutEntries = [
      "目录 v",
      "第 1 章 向量空间 ...... 1",
      "1A 向量 ...... 2",
      "复数 ...... 2",
      "向量组 ...... 4",
      "向量空间 ...... 5",
      "习题 1A ...... 9",
      "第 2 章 线性映射 ...... 20",
    ];
    const bodyEntries = layoutEntries
      .slice(1)
      .map((entry) => entry.replace(/\s+\.{2,}\s+\d+$/u, ""));
    const source = [
      "# 目录",
      "",
      ...markdownEntries.flatMap((entry) => [`## ${entry}`, ""]),
      ...bodyEntries.flatMap((entry) => [`## ${entry}`, "", "正文", ""]),
    ].join("\n");
    const indents = [0, 0, 20, 45, 45, 45, 45, 0];
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: layoutEntries.map((text, index) => ({
          bbox: [
            indents[index] ?? 0,
            20 + index * 30,
            700,
            40 + index * 30,
          ] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => ({
        level: entry.referenceLevel,
        title: entry.sourceTitle,
      })),
    ).toEqual([
      { level: 1, title: "第 1 章 向量空间 ...... 1" },
      { level: 2, title: "1A 向量 ...... 2" },
      { level: 3, title: "复数 ...... 2" },
      { level: 3, title: "向量组 ...... 4" },
      { level: 3, title: "向量空间 ...... 5" },
      { level: 3, title: "习题 1A ...... 9" },
      { level: 1, title: "第 2 章 线性映射 ...... 20" },
    ]);
  });

  it("retains a reliable native row when no body heading matches it", () => {
    const markdownEntries = [
      "第 1 章 向量空间 ...... 1",
      "1A 向量 ...... 2",
      "第 2 章 线性映射 ...... 20",
    ];
    const layoutEntries = [
      "第 1 章 向量空间 ...... 1",
      "1A 向量 ...... 2",
      "复数 ...... 2",
      "第 2 章 线性映射 ...... 20",
    ];
    const source = [
      "# 目录",
      "",
      ...markdownEntries.flatMap((entry) => [`## ${entry}`, ""]),
      "## 第 1 章 向量空间",
      "",
      "正文",
      "",
      "## 1A 向量",
      "",
      "正文",
      "",
      "## 第 2 章 线性映射",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: layoutEntries.map((text, index) => ({
          bbox: [
            index === 2 ? 45 : index === 1 ? 20 : 0,
            20 + index * 30,
            700,
            40 + index * 30,
          ] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual(layoutEntries);
    expect(result.candidates[0]?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PRINTED_TOC_UNMATCHED_ENTRY" }),
      ]),
    );
  });

  it("uses native visible math text for the printed row instead of Markdown syntax", () => {
    const markdownEntries = [
      "第 1 章 向量空间 ...... 1",
      "1A $\\mathbf { R } ^ { n }$ 和 $\\mathbf { C } ^ { n }$ ...... 2",
      "第 2 章 线性映射 ...... 20",
      "第 3 章 多项式 ...... 40",
    ];
    const layoutEntries = [
      "第 1 章 向量空间 ...... 1",
      "1A Rⁿ 和 Cⁿ ...... 2",
      "第 2 章 线性映射 ...... 20",
      "第 3 章 多项式 ...... 40",
    ];
    const source = [
      "# 目录",
      "",
      ...markdownEntries.flatMap((entry) => [`## ${entry}`, ""]),
      "## 第 1 章 向量空间",
      "",
      "正文",
      "",
      "## 1A $\\mathbf { R } ^ { n }$ 和 $\\mathbf { C } ^ { n }$",
      "",
      "正文",
      "",
      "## 第 2 章 线性映射",
      "",
      "正文",
      "",
      "## 第 3 章 多项式",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: layoutEntries.map((text, index) => ({
          bbox: [20, 20 + index * 30, 700, 40 + index * 30] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]).toMatchObject({
      sourceTitle: "1A Rⁿ 和 Cⁿ ...... 2",
    });
    expect(result.candidates[0]?.logicalEntries[1]).not.toHaveProperty(
      "bodyHeadingBlockId",
    );
  });

  it("prefers an explicitly numbered body section when duplicate titles tie", () => {
    const source = [
      "# 目录",
      "",
      "第 4 章 多项式 ...... 100",
      "",
      "多项式在 R 上的分解 ...... 107",
      "",
      "习题 4 ...... 109",
      "",
      "## 第 4 章 多项式",
      "",
      "正文",
      "",
      "## 多项式在R上的分解",
      "",
      "正文",
      "",
      "## 4.16 多项式在R上的分解",
      "",
      "正文",
      "",
      "## 习题 4",
      "",
      "正文",
    ].join("\n");
    const document = documentFor(source);
    const numberedHeading = document.headings.find((heading) =>
      heading.sourceTitle.startsWith("4.16 "),
    );
    const result = detectPrintedContents({
      document,
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(numberedHeading).toBeDefined();
    expect(result.candidates[0]?.logicalEntries[1]).toMatchObject({
      bodyHeadingBlockId: numberedHeading?.blockId,
    });
    expect(result.candidates[0]?.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PRINTED_TOC_AMBIGUOUS_MATCH" }),
      ]),
    );
  });

  it("keeps unpaged edition frontmatter and joins a detached part subtitle", () => {
    const source = [
      "# 目录",
      "",
      "## 出版者的话",
      "",
      "## 中文版序一",
      "",
      "## 中文版序二",
      "",
      "## 关于作者",
      "",
      "## 第一部分",
      "",
      "## 程序结构和执行",
      "",
      "## 第 2 章 信息的表示和处理 ...... 22",
      "",
      "## 中文版序一",
      "",
      "正文",
      "",
      "## 中文版序二",
      "",
      "正文",
      "",
      "## 关于作者",
      "",
      "正文",
      "",
      "## 第一部分",
      "",
      "## 程序结构和执行",
      "",
      "正文",
      "",
      "## 第 2 章 信息的表示和处理",
      "",
      "正文",
    ].join("\n");
    const document = documentFor(source);
    const partSubtitle = document.headings.find(
      (heading, index) => heading.sourceTitle === "程序结构和执行" && index > 6,
    );
    const result = detectPrintedContents({
      document,
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual([
      "## 出版者的话",
      "中文版序一",
      "中文版序二",
      "关于作者",
      "第一部分 程序结构和执行",
      "第 2 章 信息的表示和处理 ...... 22",
    ]);
    expect(result.candidates[0]?.logicalEntries[4]).toMatchObject({
      bodyHeadingBlockId: partSubtitle?.blockId,
      referenceLevel: 1,
    });
  });

  it("matches collapsed decimal separators and repairs damaged printed numbering", () => {
    const source = [
      "# 目录",
      "",
      "3.6.6 用条件传送来实现条件分支 ...... 200",
      "",
      "3 10.5 支持变长栈帧 ...... 300",
      "",
      "第 4 章 处理器体系结构 ...... 320",
      "",
      "## 3.66 用条件传送来实现条件分支",
      "",
      "正文",
      "",
      "## 3.10.5 支持变长栈帧",
      "",
      "正文",
      "",
      "## 第 4 章 处理器体系结构",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries.slice(0, 2)).toMatchObject([
      {
        bodyHeadingBlockId: expect.any(String),
        sourceTitle: "3.6.6 用条件传送来实现条件分支 ...... 200",
      },
      {
        bodyHeadingBlockId: expect.any(String),
        sourceTitle: "3.10.5 支持变长栈帧 ...... 300",
      },
    ]);
  });

  it("repairs compact body numbering but withholds ambiguous multi-digit gaps", () => {
    const source = [
      "# 目录",
      "",
      "2.5 小结 ...... 87",
      "",
      "8.1.2 异常的类别 ...... 504",
      "",
      "9.3.1 DRAM缓存的组织结构 ...... 562",
      "",
      "12.7.4 竞争 ...... 719",
      "",
      "## 2.5. 小结",
      "",
      "正文",
      "",
      "## 812 异常的类别",
      "",
      "正文",
      "",
      "## 931 DRAM缓存的组织结构",
      "",
      "正文",
      "",
      "## 12 7.4 竞争",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => ({
        matched: entry.bodyHeadingBlockId !== undefined,
        title: entry.sourceTitle,
      })),
    ).toEqual([
      { matched: true, title: "2.5 小结 ...... 87" },
      { matched: true, title: "8.1.2 异常的类别 ...... 504" },
      { matched: true, title: "9.3.1 DRAM缓存的组织结构 ...... 562" },
      { matched: false, title: "12.7.4 竞争 ...... 719" },
    ]);
  });

  it("keeps chapter-end reference notes and answer keys at the chapter-local level", () => {
    const source = [
      "# 目录",
      "",
      "第一部分 系统基础",
      "",
      "第 2 章 信息表示 ...... 22",
      "",
      "2.5 小结 ...... 80",
      "",
      "参考文献说明 ...... 81",
      "",
      "练习题答案 ...... 82",
      "",
      "## 第一部分 系统基础",
      "",
      "## 第 2 章 信息表示",
      "",
      "## 2.5 小结",
      "",
      "## 参考文献说明",
      "",
      "## 练习题答案",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: [
          ["第一部分 系统基础", 0],
          ["第 2 章 信息表示 ...... 22", 20],
          ["2.5 小结 ...... 80", 40],
          ["参考文献说明 ...... 81", 60],
          ["练习题答案 ...... 82", 80],
        ].map(([text, indent], index) => ({
          bbox: [
            indent as number,
            20 + index * 30,
            700,
            40 + index * 30,
          ] as const,
          pageIndex: 0,
          text: text as string,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries
        .slice(-2)
        .map((entry) => entry.referenceLevel),
    ).toEqual([3, 3]);
  });

  it("does not fuzzy-match a printed title containing replacement characters", () => {
    const source = [
      "# 目录",
      "",
      "## 第 1 章 向量空间 ...... 1",
      "",
      "## 1A R� 和 C� ...... 2",
      "",
      "## 第 2 章 线性映射 ...... 20",
      "",
      "## 第 1 章 向量空间",
      "",
      "正文",
      "",
      "## 1A Rn 和 Cn",
      "",
      "正文",
      "",
      "## 第 2 章 线性映射",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]).not.toHaveProperty(
      "bodyHeadingBlockId",
    );
    expect(result.candidates[0]?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PRINTED_TOC_UNMATCHED_ENTRY" }),
      ]),
    );
  });

  it("preserves complete short Markdown rows over damaged native PDF text", () => {
    const markdownEntries = [
      "第 15 章 动态规划 ...... 204",
      "本章注记 ...... 236",
      "第 16 章 贪心算法 ...... 237",
      "6.3 建堆 ...... 87",
      "附录 A 求和 ...... 672",
      "B.2 关系 ...... 682",
      "B.3 函数 ...... 683",
      "B.5 树 ...... 687",
      "第 17 章 摊还分析 ...... 450",
    ];
    const layoutEntries = [
      "第 15 章 动态规划 ...... 204",
      "本章注记 ...... 236",
      "143 第 16 章贪心算法 ...... 237",
      "6. 3 建堆 ...... 87",
      "附录 A ...... 672",
      "B. 2 关系 ...... 682",
      "B. 3 函数 ...... 683",
      "B. 5 树 ...... 687",
      "第 17 章 摊还分析 ...... 450",
    ];
    const bodyEntries = [
      "动态规划",
      "本章注记",
      "贪心算法",
      "6.3 建堆",
      "求和",
      "B.2 关系",
      "B.3 函数",
      "B.5 树",
      "摊还分析",
    ];
    const source = [
      "# Contents",
      "",
      ...markdownEntries.flatMap((entry) => [`## ${entry}`, ""]),
      ...bodyEntries.flatMap((entry) => [`## ${entry}`, "", "Body", ""]),
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: layoutEntries.map((text, index) => ({
          bbox: [20, 20 + index * 30, 700, 40 + index * 30] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual(markdownEntries);
    expect(result.candidates[0]?.matchedHeadingCount).toBe(
      markdownEntries.length,
    );
  });

  it("recovers visual row order when MinerU crosses native PDF columns", () => {
    const markdownEntries = [
      "第四部分 高级设计和分析技术",
      "15.1 钢条切割 ...... 204",
      "15.2 矩阵链乘法 ...... 210",
      "思考题 ...... 231",
      "第 15 章 动态规划 ...... 204",
      "本章注记 ...... 236",
      "第 16 章 贪心算法 ...... 237",
    ];
    const layoutEntries = [
      "第四部分 高级设计和分析技术",
      "第 15 章 动态规划 ...... 204",
      "15.1 钢条切割 ...... 204",
      "15.2 矩阵链乘法 ...... 210",
      "思考题 ...... 231",
      "本章注记 ...... 236",
      "第 16 章 贪心算法 ...... 237",
    ];
    const bodyEntries = [
      "高级设计和分析技术",
      "动态规划",
      "15.1 钢条切割",
      "15.2 矩阵链乘法",
      "思考题",
      "本章注记",
      "贪心算法",
    ];
    const source = [
      "# 目录",
      "",
      ...markdownEntries.flatMap((entry) => [`## ${entry}`, ""]),
      ...bodyEntries.flatMap((entry) => [`## ${entry}`, "", "正文", ""]),
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: layoutEntries.map((text, index) => ({
          bbox: [20, 20 + index * 30, 700, 40 + index * 30] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => ({
        level: entry.referenceLevel,
        title: entry.sourceTitle,
      })),
    ).toEqual(
      layoutEntries.map((title, index) => ({
        level: [1, 2, 3, 3, 3, 3, 2][index],
        title,
      })),
    );
    expect(result.candidates[0]?.matchedHeadingCount).toBe(
      layoutEntries.length,
    );
    expect(
      result.candidates[0]?.proposedRegion?.entries.every(
        (entry, index, entries) =>
          index === 0 ||
          entry.range.start_byte >= (entries[index - 1]?.range.end_byte ?? 0),
      ),
    ).toBe(true);
  });

  it("joins a wrapped optional section before matching it to the body", () => {
    const source = [
      "# 目录",
      "",
      "第 5 章 概率分析 ...... 65",
      "",
      "\\* 5.4 概率分析和指示器随机变量的",
      "进一步使用 ...... 73",
      "",
      "第 6 章 堆排序 ...... 84",
      "",
      "## 第 5 章 概率分析",
      "",
      "正文",
      "",
      "## \\* 5.4 概率分析和指示器随机变量的进一步使用",
      "",
      "正文",
      "",
      "## 第 6 章 堆排序",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]).toMatchObject({
      bodyHeadingBlockId: expect.any(String),
      referenceLevel: 2,
      sourceTitle: "\\* 5.4 概率分析和指示器随机变量的 进一步使用 ...... 73",
    });
  });

  it("does not let fused layout invent chapter-local rows between source anchors", () => {
    const source = [
      "# Contents",
      "",
      "## 2 Overview ...... 9",
      "",
      "Bibliographic Notes . . . . .",
      "",
      "Exercises . . . . .",
      "",
      "## 3 Regression ...... 43",
      "",
      "## 4 Classification ...... 101",
      "",
      "## 2 Overview",
      "",
      "Body",
      "",
      "## Bibliographic Notes",
      "",
      "Body",
      "",
      "## Exercises",
      "",
      "Body",
      "",
      "## 3 Regression",
      "",
      "Body",
      "",
      "## 4 Classification",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: [
          "2 Overview ...... 9",
          "Bibliographic Notes ...... 39",
          "Exercises ...... 39",
          "3 Regression ...... 43",
          "4 Classification ...... 101",
        ].map((text, index) => ({
          bbox: [20, 20 + index * 30, 700, 40 + index * 30] as const,
          pageIndex: 0,
          ...(index === 0 ? { pageLabelSupplemented: true } : {}),
          text,
          type: "text" as const,
        })),
        source: "content-list",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) =>
        entry.sourceTitle.replace(/^#{1,6}\s+/u, ""),
      ),
    ).toEqual([
      "2 Overview ...... 9",
      "3 Regression ...... 43",
      "4 Classification ...... 101",
    ]);
  });

  it("fills a small layout-only gap between reliable source anchors", () => {
    const source = [
      "# Contents",
      "",
      "## 6.2 Difference detection ...... 297",
      "",
      "## 6.2.2 Checksum ...... 299",
      "",
      "## 6.3 Access links ...... 301",
      "",
      "## 6.2 Difference detection",
      "",
      "Body",
      "",
      "## 6.2.1 Parity",
      "",
      "Body",
      "",
      "## 6.2.2 Checksum",
      "",
      "Body",
      "",
      "## 6.3 Access links",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: [
          "6.2 Difference detection ...... 297",
          "6.2.1 Parity ...... 298",
          "6.2.2 Checksum ...... 299",
          "6.3 Access links ...... 301",
        ].map((text, index) => ({
          bbox: [
            20 + (index === 1 ? 20 : 0),
            20 + index * 30,
            700,
            40 + index * 30,
          ] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual([
      "6.2 Difference detection ...... 297",
      "6.2.1 Parity ...... 298",
      "6.2.2 Checksum ...... 299",
      "6.3 Access links ...... 301",
    ]);
  });

  it("restores a missing printed page label from an aligned layout row", () => {
    const source = [
      "## 目录",
      "",
      "1 导论 ...... 1",
      "",
      "1.1 什么是计量经济学?",
      "",
      "1.2 数据类型 ...... 3",
      "",
      "## 1 导论",
      "",
      "正文",
      "",
      "## 1.1 什么是计量经济学?",
      "",
      "正文",
      "",
      "## 1.2 数据类型",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: [
          "1 导论 ...... 1",
          "1.1 什么是计量经济学? ...... 1",
          "1.2 数据类型 ...... 3",
        ].map((text, index) => ({
          bbox: [20, 20 + index * 30, 700, 40 + index * 30] as const,
          pageIndex: 0,
          ...(index === 1 ? { pageLabelSupplemented: true } : {}),
          text,
          type: "text" as const,
        })),
        source: "content-list",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]?.sourceTitle).toBe(
      "1.1 什么是计量经济学?  1",
    );
    expect(supplementalPdfPageIndices(result)).toEqual([0]);
  });

  it("restores a missing page label on an unnumbered nested contents row", () => {
    const source = [
      "## 目录",
      "",
      "第 1 章 向量空间 ...... 1",
      "",
      "复数 . . . . . .",
      "",
      "下一主题 . . . . . . 3",
      "",
      "最后主题 . . . . . . 4",
      "",
      "## 第 1 章 向量空间",
      "",
      "正文",
      "",
      "## 复数",
      "",
      "正文",
      "",
      "## 下一主题",
      "",
      "正文",
      "",
      "## 最后主题",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: [
          "第 1 章 向量空间 ...... 1",
          "复数 . . . . . . 2",
          "下一主题 . . . . . . 3",
          "最后主题 . . . . . . 4",
        ].map((text, index) => ({
          bbox: [
            20 + (index === 0 ? 0 : 24),
            20 + index * 30,
            700,
            40 + index * 30,
          ] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual([
      "第 1 章 向量空间 ...... 1",
      "复数 . . . . . . 2",
      "下一主题 . . . . . . 3",
      "最后主题 . . . . . . 4",
    ]);
  });

  it("inserts a native-only row beside a damaged but identifiable source row", () => {
    const source = [
      "## 目录",
      "",
      "第 1 章 向量空间 ...... 1",
      "",
      "1A R� 和 C� . . . . . . 2",
      "",
      "组 . . . . . . 4",
      "",
      "下一主题 . . . . . . 5",
      "",
      "最后主题 . . . . . . 6",
      "",
      "## 第 1 章 向量空间",
      "",
      "正文",
      "",
      "## 组",
      "",
      "正文",
      "",
      "## 下一主题",
      "",
      "正文",
      "",
      "## 最后主题",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: [
          "第 1 章 向量空间 ...... 1",
          "1A Rn 和 Cn . . . . . . 2",
          "复数 . . . . . . 2",
          "组 . . . . . . 4",
          "下一主题 . . . . . . 5",
          "最后主题 . . . . . . 6",
        ].map((text, index) => ({
          bbox: [
            20 + (index === 0 ? 0 : 24),
            20 + index * 30,
            700,
            40 + index * 30,
          ] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual([
      "第 1 章 向量空间 ...... 1",
      "1A Rn 和 Cn . . . . . . 2",
      "复数 . . . . . . 2",
      "组 . . . . . . 4",
      "下一主题 . . . . . . 5",
      "最后主题 . . . . . . 6",
    ]);
  });

  it("repairs a replacement-damaged technical row from the same native page slot", () => {
    const source = [
      "## 目录",
      "",
      "第 3 章 线性映射 ...... 43",
      "",
      "L(�, �) 上的代数运算 ...... 46",
      "",
      "习题 3A ...... 48",
      "",
      "3B 零空间和值域 ...... 50",
      "",
      "## 第 3 章 线性映射",
      "",
      "正文",
      "",
      "## 习题 3A",
      "",
      "正文",
      "",
      "## 3B 零空间和值域",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: [
          "第 3 章 线性映射 ...... 43",
          "L(V, W) 上的代数运算 ...... 46",
          "习题 3A ...... 48",
          "3B 零空间和值域 ...... 50",
        ].map((text, index) => ({
          bbox: [
            20 + (index === 0 ? 0 : 24),
            20 + index * 30,
            700,
            40 + index * 30,
          ] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]?.sourceTitle).toBe(
      "L(V, W) 上的代数运算 ...... 46",
    );
    expect(result.candidates[0]?.logicalEntries[1]).not.toHaveProperty(
      "bodyHeadingBlockId",
    );
  });

  it("does not infer a native page label from a lone trailing period", () => {
    const source = [
      "## Contents",
      "",
      "14.3.4 Previous ...... 503",
      "",
      "14.3.5 Combinatorial Algorithms .",
      "",
      "14.3.6 Next ...... 511",
      "",
      "## 14.3.4 Previous",
      "",
      "Body",
      "",
      "## 14.3.5 Combinatorial Algorithms .",
      "",
      "Body",
      "",
      "## 14.3.6 Next",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      layoutEvidence: {
        diagnostics: [],
        records: [
          "14.3.4 Previous ...... 503",
          "14.3.5 Combinatorial Algorithms ...... 507",
          "14.3.6 Next ...... 511",
        ].map((text, index) => ({
          bbox: [20, 20 + index * 30, 700, 40 + index * 30] as const,
          pageIndex: 0,
          text,
          type: "text" as const,
        })),
        source: "native-pdf",
      },
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[1]?.sourceTitle).toBe(
      "14.3.5 Combinatorial Algorithms .",
    );
  });

  it("matches a nested printed appendix group without treating it as top-level", () => {
    const source = [
      "## Contents",
      "",
      "5.9.2 Adaptive Filtering ...... 179",
      "",
      "Appendix: Computational Considerations for Splines ...... 186",
      "",
      "Appendix: B-splines ...... 186",
      "",
      "Appendix: Computations for Smoothing Splines ...... 189",
      "",
      "6 Kernel Methods ...... 191",
      "",
      "## 5.9.2 Adaptive Filtering",
      "",
      "Body",
      "",
      "## Appendix: Computations for Splines",
      "",
      "Body",
      "",
      "## B-splines",
      "",
      "Body",
      "",
      "## Computations for Smoothing Splines",
      "",
      "Body",
      "",
      "## 6 Kernel Methods",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.slice(1, 4).map((entry) => ({
        matched: Boolean(entry.bodyHeadingBlockId),
        level: entry.referenceLevel,
      })),
    ).toEqual([
      { level: 2, matched: true },
      { level: 3, matched: true },
      { level: 3, matched: true },
    ]);
  });

  it("matches a supplemental part to an appendix-labelled body heading", () => {
    const source = [
      "## 目录",
      "",
      "第八部分 附录：数学基础知识",
      "",
      "附录 A 求和 ...... 672",
      "",
      "A.1 求和公式及其性质 ...... 672",
      "",
      ...Array.from({ length: 10 }, () => ["目录后说明", ""]).flat(),
      "",
      "## 附录：数学基础知识",
      "",
      "正文",
      "",
      "## 求和",
      "",
      "正文",
      "",
      "## A.1 求和公式及其性质",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries).toMatchObject([
      { bodyHeadingBlockId: expect.any(String), referenceLevel: 1 },
      { bodyHeadingBlockId: expect.any(String), referenceLevel: 2 },
      { bodyHeadingBlockId: expect.any(String), referenceLevel: 3 },
    ]);
  });

  it("retains edition prefaces and governance units before the first chapter", () => {
    const source = [
      "## 目录",
      "",
      "出版者的话",
      "",
      "专家指导委员会",
      "",
      "第2版前言",
      "",
      "第1版前言",
      "",
      "致谢",
      "",
      "第1章 开始 ...... 1",
      "",
      "## 出版者的话",
      "",
      "正文",
      "",
      "## 专家指导委员会",
      "",
      "正文",
      "",
      "## 第2版前言",
      "",
      "正文",
      "",
      "## 第1版前言",
      "",
      "正文",
      "",
      "## 致谢",
      "",
      "正文",
      "",
      "## 第1章 开始",
      "",
      "正文",
    ].join("\n");

    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) =>
        entry.sourceTitle.trim(),
      ),
    ).toEqual([
      "出版者的话",
      "专家指导委员会",
      "第2版前言",
      "第1版前言",
      "致谢",
      "第1章 开始 ...... 1",
    ]);
  });

  it("joins a numbered title to its same-paragraph page-label continuation", () => {
    const source = [
      "## 目录",
      "",
      "3.5.4 流和延时求值 ...... 241",
      "",
      "3.5.5 函数式程序的模块化和对象的",
      "模块化 ...... 245",
      "",
      "第4章 元语言抽象 ...... 249",
      "",
      "## 3.5.4 流和延时求值",
      "",
      "正文",
      "",
      "## 3.5.5 函数式程序的模块化和对象的模块化",
      "",
      "正文",
      "",
      "## 第4章 元语言抽象",
      "",
      "正文",
    ].join("\n");

    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) =>
        entry.sourceTitle.trim(),
      ),
    ).toEqual([
      "3.5.4 流和延时求值 ...... 241",
      "3.5.5 函数式程序的模块化和对象的 模块化 ...... 245",
      "第4章 元语言抽象 ...... 249",
    ]);
  });

  it("recognizes an early unlabelled chapter list without page suffixes", async () => {
    const source = await readFile(unlabelledPath, "utf8");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      confidence: "high",
      entryCount: 4,
      matchedHeadingCount: 4,
    });
    expect(
      result.candidates[0]?.proposedRegion?.entries.map(
        (entry) => entry.reference_level,
      ),
    ).toEqual([1, 1, 1, 1]);
  });

  it("includes an unnumbered frontmatter entry at an unlabelled boundary", () => {
    const source = [
      "# Book",
      "",
      "## 前言",
      "",
      "## 第一章 甲",
      "",
      "## 第二章 乙",
      "",
      "## 第三章 丙",
      "",
      "## 前言",
      "",
      "正文",
      "",
      "## 第一章 甲",
      "",
      "正文",
      "",
      "## 第二章 乙",
      "",
      "正文",
      "",
      "## 第三章 丙",
      "",
      "正文",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]).toMatchObject({
      entryCount: 4,
      proposedRegion: expect.objectContaining({
        range: expect.objectContaining({
          start_byte: Buffer.byteLength("# Book\n\n", "utf8"),
        }),
      }),
    });
  });

  it("matches a printed frontmatter entry before the contents region", () => {
    const source = [
      "# Book",
      "",
      "## 作者简介",
      "",
      "正文",
      "",
      "## 目录",
      "",
      "## 作者简介 ...... vii",
      "",
      "## 第1章 起步 ...... 1",
      "",
      "## 1.1 基础 ...... 2",
      "",
      "## 第1章 起步",
      "",
      "正文",
      "",
      "## 1.1 基础",
      "",
      "正文",
    ].join("\n");
    const document = documentFor(source);
    const frontmatter = document.headings.find(
      (heading) => heading.sourceTitle === "作者简介",
    );
    const result = detectPrintedContents({
      document,
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.logicalEntries[0]?.bodyHeadingBlockId).toBe(
      frontmatter?.blockId,
    );
  });

  it("recognizes bilingual brief and full contents labels", () => {
    const source = [
      "# Book",
      "",
      "## Brief Contents 简明目录",
      "",
      "Chapter 1 Start 1",
      "",
      "Chapter 2 Continue 9",
      "",
      "## Contents 目录",
      "",
      "Chapter 1 Start 1",
      "",
      "1.1 Basics 2",
      "",
      "Chapter 2 Continue 9",
      "",
      "## Chapter 1 Start",
      "",
      "## 1.1 Basics",
      "",
      "## Chapter 2 Continue",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: (() => {
        let ordinal = 0;
        return () => `region_${String(++ordinal).padStart(16, "0")}`;
      })(),
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.entryCount)).toEqual([
      2, 3,
    ]);
    expect(
      result.candidates.filter((candidate) => candidate.canonical),
    ).toHaveLength(1);
    expect(
      result.candidates.find((candidate) => candidate.canonical)?.entryCount,
    ).toBe(3);
  });

  it("folds adjacent bilingual label blocks into one region", () => {
    const source = [
      "# Contents",
      "",
      "# 目录",
      "",
      "# Chapter 1 Start 1",
      "",
      "# Chapter 2 Continue 9",
      "",
      "# Chapter 3 Finish 17",
      "",
      "# Chapter 1 Start",
      "",
      "Body",
      "",
      "# Chapter 2 Continue",
      "",
      "Body",
      "",
      "# Chapter 3 Finish",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      entryCount: 3,
      proposedRegion: expect.objectContaining({
        range: expect.objectContaining({ start_byte: 0 }),
      }),
    });
  });

  it("does not impose a fixed root-block window on an unlabelled contents", () => {
    const preface = Array.from({ length: 120 }, (_, index) =>
      index === 30
        ? "Chapter 99 appears in this isolated preface note"
        : `Preface paragraph ${index + 1}.`,
    );
    const tail = Array.from(
      { length: 140 },
      (_, index) => `Body paragraph ${index + 1}.`,
    );
    const source = [
      "# Book",
      "",
      ...preface,
      "",
      "Chapter 1 Start 1",
      "",
      "Chapter 2 Continue 9",
      "",
      "Chapter 3 Finish 17",
      "",
      "## Chapter 1 Start",
      "",
      "## Chapter 2 Continue",
      "",
      "## Chapter 3 Finish",
      "",
      ...tail,
    ].join("\n\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]).toMatchObject({
      boundaryConfidence: "high",
      entryCount: 3,
      proposedRegion: expect.objectContaining({ applied: true }),
    });
  });

  it("locates an unmatched entry at the nearest reliable body heading", () => {
    const source = [
      "## 目录",
      "",
      "第1章 基础 ...... 1",
      "",
      "1.1 起步 ...... 3",
      "",
      "1.2 缺失 ...... 7",
      "",
      "1.3 继续 ...... 9",
      "",
      "## 第1章 基础",
      "",
      "正文",
      "",
      "## 1.1 起步",
      "",
      "正文",
      "",
      "## 1.3 继续",
      "",
      "正文",
      "",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.diagnostics).toContainEqual(
      expect.objectContaining({
        blockId: expect.stringMatching(/^blk_/u),
        code: "PRINTED_TOC_UNMATCHED_ENTRY",
      }),
    );
  });

  it("recognizes spaced leaders and ordinary right-side page labels", () => {
    const source = [
      "# Book",
      "",
      "Preface . . . . vii",
      "",
      "Introduction  1",
      "",
      "Notation 4",
      "",
      "## Preface",
      "",
      "Body",
      "",
      "## Introduction",
      "",
      "Body",
      "",
      "## Notation",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      boundaryConfidence: "high",
      entryCount: 3,
      matchedHeadingCount: 3,
    });
  });

  it("requests PDF repair only when the printed row itself is damaged", () => {
    const detect = (firstRow: string) => {
      const source = [
        "## Contents",
        "",
        firstRow,
        "",
        "Chapter 1 Start .... 1",
        "",
        "Chapter 2 Middle .... 9",
        "",
        "Chapter 3 End .... 20",
        "",
        "## Chapter 1 Start",
        "",
        "## Chapter 2 Middle",
        "",
        "## Chapter 3 End",
      ].join("\n");
      return detectPrintedContents({
        document: documentFor(source),
        idFactory: () => "region_abcdefghijklmnop",
        sourcePath: "source/full.md",
        sourceSha256: createHash("sha256").update(source).digest("hex"),
      });
    };

    expect(detect("...... 4").candidates[0]?.requiresPdfEvidence).toBe(true);
    expect(detect("A ......").candidates[0]?.requiresPdfEvidence).toBe(true);
    expect(detect("A ...... 4").candidates[0]?.requiresPdfEvidence).toBe(false);
    expect(
      detect("1.1 Missing page label").candidates[0]?.requiresPdfEvidence,
    ).toBe(true);
    const merged = detect(
      "2.11 Summary 100 Practice Exercises 101 Further Reading 101",
    ).candidates[0];
    expect(merged?.requiresPdfEvidence).toBe(true);
    expect(
      merged?.logicalEntries
        .slice(0, 3)
        .map((entry) => entry.sourceTitle.trim()),
    ).toEqual([
      "2.11 Summary 100",
      "Practice Exercises 101",
      "Further Reading 101",
    ]);
    const spacedNumbering = detect("1. 1. 2 服务描述 6").candidates[0];
    expect(spacedNumbering?.requiresPdfEvidence).toBe(false);
    expect(spacedNumbering?.logicalEntries[0]?.sourceTitle.trim()).toBe(
      "1. 1. 2 服务描述 6",
    );
  });

  it("joins a detached Markdown section number to a technical-number title", () => {
    const source = [
      "## Contents",
      "",
      "## 7.3 WiFi ...... 356",
      "",
      "## 7.3.1",
      "",
      "## 802.11 wireless architecture ...... 357",
      "",
      "## 7.3.2 MAC protocol ...... 359",
      "",
      "## 7.3 WiFi",
      "",
      "Body",
      "",
      "## 7.3.1 802.11 wireless architecture",
      "",
      "Body",
      "",
      "## 7.3.2 MAC protocol",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual([
      expect.stringContaining("7.3 WiFi"),
      "7.3.1 802.11 wireless architecture ...... 357",
      expect.stringContaining("7.3.2 MAC protocol"),
    ]);
  });

  it("keeps brief and full contents as disjoint exclusions with one canonical region", () => {
    const brief = [
      "Chapter 1 Start .... 1",
      "Chapter 2 Middle .... 9",
      "Chapter 3 End .... 20",
    ];
    const full = [...brief, "Appendix A Tables .... 30"];
    const body = full.map((title) => title.replace(/\s+\.{2,}\s+\d+$/u, ""));
    const source = [
      "## Brief Contents",
      "",
      ...brief.flatMap((title) => [`## ${title}`, ""]),
      "## Contents",
      "",
      ...full.flatMap((title) => [`## ${title}`, ""]),
      ...body.flatMap((title) => [`## ${title}`, "", "Body", ""]),
    ].join("\n");
    let region = 0;
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => `region_${String(++region).padStart(16, "0")}`,
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates).toHaveLength(2);
    expect(
      result.candidates.map((candidate) => candidate.proposedRegion?.region_id),
    ).toEqual(["region_0000000000000001", "region_0000000000000002"]);
    expect(result.canonicalRegionId).toBe("region_0000000000000002");
    expect(result.candidates.map((candidate) => candidate.canonical)).toEqual([
      false,
      true,
    ]);
    expect(
      result.candidates[0]?.proposedRegion?.entries.every(
        (entry) => entry.body_heading_block_id === undefined,
      ),
    ).toBe(true);
    expect(
      result.candidates[1]?.proposedRegion?.entries.every(
        (entry) => entry.body_heading_block_id !== undefined,
      ),
    ).toBe(true);
    const acceptedRegions = result.candidates.flatMap((candidate) =>
      candidate.proposedRegion ? [candidate.proposedRegion] : [],
    );
    const activeDocument = applySourceRegions({
      document: documentFor(source),
      mainMarkdownPath: "source/full.md",
      mainMarkdownSha256: createHash("sha256").update(source).digest("hex"),
      regions: acceptedRegions,
    }).document;
    expect(
      activeDocument.headings.map((heading) => heading.sourceTitle),
    ).toEqual(body);
    expect(
      proposeDocumentStructure(activeDocument, {
        sourceRegions: acceptedRegions,
      }).nodes.map((node) => node.display_level),
    ).toEqual([1, 1, 1, 1]);
    expect(
      (result.candidates[0]?.endByte ?? 0) <
        (result.candidates[1]?.startByte ?? 0),
    ).toBe(true);
  });

  it("keeps scanning after one non-entry block and ends at the last reliable row", () => {
    const source = [
      "## Contents",
      "",
      "Chapter 1 Start .... 1",
      "",
      "Printed on acid-free paper.",
      "",
      "Chapter 2 Middle .... 9",
      "",
      "Chapter 3 End .... 20",
      "",
      "## Chapter 1 Start",
      "",
      "## Chapter 2 Middle",
      "",
      "## Chapter 3 End",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]).toMatchObject({
      entryCount: 3,
      proposedRegion: expect.objectContaining({ applied: true }),
    });
    expect(result.candidates[0]?.proposedRegion?.range.sha256).toBeDefined();
  });

  it("ends before a detached body part label whose title matches the contents", () => {
    const source = [
      "## Contents",
      "",
      "Part One Overview .... 1",
      "",
      "Chapter 1 Start .... 3",
      "",
      "Chapter 2 Continue .... 9",
      "",
      "# Part One",
      "",
      "# Overview",
      "",
      "Body",
      "",
      "## Chapter 1 Start",
      "",
      "## Chapter 2 Continue",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.endByte).toBeLessThan(
      Buffer.byteLength(source.slice(0, source.indexOf("# Part One")), "utf8") +
        1,
    );
  });

  it("rejects a late index-shaped Contents block without later body recurrence", () => {
    const body = Array.from(
      { length: 30 },
      (_, index) => `## Section ${index + 1}\n\nBody`,
    );
    const source = [
      "# Book",
      "",
      ...body,
      "",
      "## Contents",
      "",
      "Section 1 .... 1",
      "",
      "Section 2 .... 2",
      "",
      "Section 3 .... 3",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      boundaryConfidence: "low",
    });
    expect(result.candidates[0]?.proposedRegion).toBeUndefined();
  });

  it("reports best and second-best alignment scores with local skip recovery", () => {
    const source = [
      "## Contents",
      "",
      "1 Start .... 1",
      "",
      "2 Missing .... 3",
      "",
      "3 Continue .... 5",
      "",
      "## 1 Start",
      "",
      "Body",
      "",
      "## Extra body heading",
      "",
      "Body",
      "",
      "## 3 Continue",
      "",
      "Body",
    ].join("\n");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.candidates[0]?.alignment).toMatchObject({
      bestScore: expect.any(Number),
      margin: expect.any(Number),
      secondBestScore: expect.any(Number),
    });
    expect(result.candidates[0]?.matchedHeadingCount).toBe(2);
    expect(result.candidates[0]?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PRINTED_TOC_UNMATCHED_ENTRY" }),
    );
  });
});
