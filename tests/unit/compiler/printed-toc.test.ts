import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import { detectPrintedContents } from "@/compiler/document/printed-toc";
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

  it("refuses automatic application when the candidate contains rich content", () => {
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
    expect(result.candidates[0]?.proposedRegion).toBeUndefined();
    expect(result.candidates[0]?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PRINTED_TOC_RICH_CONTENT" }),
    );
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
      entryCount: 3,
      matchedHeadingCount: 3,
    });
    expect(
      result.candidates[0]?.proposedRegion?.entries.map(
        (entry) => entry.reference_level,
      ),
    ).toEqual([1, 1, 1]);
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
