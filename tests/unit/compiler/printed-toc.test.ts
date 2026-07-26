import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import {
  detectPrintedContents,
  inferPrintedHeadingEvidence,
  inferPrintedReferenceLevels,
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
