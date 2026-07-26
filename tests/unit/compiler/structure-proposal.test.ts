import { describe, expect, it } from "vitest";

import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import { proposeDocumentStructure } from "@/compiler/document/structure-proposal";

describe("default document structure proposal", () => {
  it("keeps cover metadata before numbered chapters out of navigation", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "# Book Title",
          "",
          "Cover copy",
          "",
          "# Book Title",
          "",
          "## [Author] Name",
          "",
          "## Preface",
          "",
          "Preface body",
          "",
          "## Chapter 1 Opening",
          "",
          "Chapter body",
        ].join("\n"),
      ),
    );

    expect(
      proposeDocumentStructure(document).nodes.map((node) => ({
        include_in_toc: node.include_in_toc,
        level: node.display_level,
      })),
    ).toEqual([
      { include_in_toc: false, level: 1 },
      { include_in_toc: false, level: 1 },
      { include_in_toc: false, level: 1 },
      { include_in_toc: true, level: 1 },
      { include_in_toc: true, level: 1 },
    ]);
  });

  it("keeps heading order, closes level gaps and starts only major units on pages", () => {
    const normalized = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## 前言",
          "Text",
          "#### Details",
          "### More",
          "# Chapter",
          "#### Deep",
          "# 附录 A",
          "## Data",
          "# 参考文献",
        ].join("\n\n"),
      ),
      {
        idFactory: (() => {
          let id = 0;
          return () => `blk_test_${++id}`;
        })(),
      },
    );
    const proposal = proposeDocumentStructure(normalized);

    expect(proposal.nodes.map((node) => node.block_id)).toEqual(
      normalized.headings.map((heading) => heading.blockId),
    );
    expect(proposal.nodes.map((node) => node.display_level)).toEqual([
      1, 2, 2, 1, 2, 1, 2, 1,
    ]);
    expect(proposal.nodes.map((node) => node.starts_page)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(proposal.nodes.map((node) => node.role)).toEqual([
      "frontmatter",
      undefined,
      undefined,
      "body",
      undefined,
      "appendix",
      undefined,
      "backmatter",
    ]);
    expect(proposal.nodes.every((node) => node.include_in_toc)).toBe(true);
  });

  it("does not mutate source or normalized headings", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument("# One\n\n### Three"),
    );
    const before = JSON.stringify(document);

    proposeDocumentStructure(document);

    expect(JSON.stringify(document)).toBe(before);
  });

  it("keeps a chapter whole when there is no second-level heading", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument("# One\n\nText\n\n# Two\n\nText"),
    );

    expect(
      proposeDocumentStructure(document).nodes.map((node) => node.starts_page),
    ).toEqual([true, true]);
  });

  it("uses printed nesting instead of flat MinerU H2 levels", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## 第1章 基础",
          "",
          "正文",
          "",
          "## 1.1 起步",
          "",
          "正文",
          "",
          "## 1.2 继续",
          "",
          "正文",
        ].join("\n"),
      ),
    );
    const sourceRegions = [
      {
        applied: true,
        disposition: "reference_only" as const,
        entries: document.headings.map((heading, index) => ({
          body_heading_block_id: heading.blockId,
          range: {
            end_byte: index * 2 + 2,
            sha256: "a".repeat(64),
            start_byte: index * 2 + 1,
          },
          reference_level: index === 0 ? 1 : 2,
        })),
        kind: "printed_toc" as const,
        range: {
          end_byte: 7,
          sha256: "b".repeat(64),
          start_byte: 1,
        },
        region_id: "region_abcdefghijklmnop",
        source_path: "full.md",
        source_sha256: "c".repeat(64),
      },
    ];

    const proposal = proposeDocumentStructure(document, { sourceRegions });
    expect(proposal.nodes.map((node) => node.display_level)).toEqual([1, 2, 2]);
    expect(proposal.nodes.map((node) => node.starts_page)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("carries an inferred part offset into body-only descendants", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## Preface",
          "",
          "Body",
          "",
          "## Chapter 1 Introduction",
          "",
          "Body",
          "",
          "## 1.1 Overview",
          "",
          "Body",
          "",
          "## 1.1.1 Detail",
          "",
          "Body",
        ].join("\n"),
      ),
    );
    const chapter = document.headings[1];
    const section = document.headings[2];
    if (!chapter || !section) throw new Error("expected headings");
    const sourceRegions = [
      {
        applied: true,
        disposition: "reference_only" as const,
        entries: [
          {
            body_heading_block_id: chapter.blockId,
            range: {
              end_byte: 2,
              sha256: "a".repeat(64),
              start_byte: 1,
            },
            reference_level: 2,
          },
          {
            body_heading_block_id: section.blockId,
            range: {
              end_byte: 4,
              sha256: "b".repeat(64),
              start_byte: 3,
            },
            reference_level: 3,
          },
        ],
        kind: "printed_toc" as const,
        range: {
          end_byte: 4,
          sha256: "c".repeat(64),
          start_byte: 1,
        },
        region_id: "region_0123456789abcdef",
        source_path: "book.md",
        source_sha256: "d".repeat(64),
      },
    ];

    expect(
      proposeDocumentStructure(document, { sourceRegions }).nodes.map(
        (node) => node.display_level,
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  it("keeps part nesting when a printed entry did not match its body heading", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## 第 1 章 计算机系统漫游",
          "",
          "正文",
          "",
          "## 第一部分 程序结构和执行",
          "",
          "正文",
          "",
          "## 第 2 章 信息的表示和处理",
          "",
          "正文",
          "",
          "## 2.1 信息存储",
          "",
          "正文",
          "",
          "## 旁注 怎样阅读本章",
          "",
          "正文",
          "",
          "## 2.1.1 十六进制表示法",
          "",
          "正文",
          "",
          "## 附录 A 错误处理",
          "",
          "正文",
        ].join("\n"),
      ),
    );

    expect(
      proposeDocumentStructure(document).nodes.map(
        (node) => node.display_level,
      ),
    ).toEqual([1, 1, 2, 3, 3, 4, 1]);
  });

  it("keeps parenthesized local parts inside their numbered section", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## 1 导论",
          "",
          "正文",
          "",
          "## 1.8 EViews 简介",
          "",
          "正文",
          "",
          "## 第一部分(概述)",
          "",
          "正文",
          "",
          "## 第二部分(基本数据分析)",
          "",
          "正文",
          "",
          "## 1.9 延伸阅读",
          "",
          "正文",
        ].join("\n"),
      ),
    );

    const proposal = proposeDocumentStructure(document);
    expect(proposal.nodes.map((node) => node.display_level)).toEqual([
      1, 2, 3, 3, 2,
    ]);
    expect(proposal.nodes.map((node) => node.include_in_toc)).toEqual([
      true,
      true,
      false,
      false,
      true,
    ]);
    expect(proposal.nodes.map((node) => node.starts_page)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("joins a part label and title across an ornamental part marker", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## 第一部分",
          "",
          "P A R T 1",
          "",
          "# 程序结构和执行",
          "",
          "正文",
        ].join("\n"),
      ),
    );

    const proposal = proposeDocumentStructure(document);
    expect(proposal.nodes[0]).toMatchObject({
      display_level: 1,
      display_title: "第一部分程序结构和执行",
      include_in_toc: true,
    });
    expect(proposal.nodes[1]).toMatchObject({
      display_level: 1,
      include_in_toc: false,
      starts_page: false,
    });
  });

  it("joins a detached numeric chapter marker into the following title", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        ["## 1", "", "## 导论", "", "正文", "", "## 1.1 起步"].join("\n"),
      ),
    );

    const proposal = proposeDocumentStructure(document);
    expect(proposal.nodes[0]).toMatchObject({
      include_in_toc: false,
      starts_page: false,
    });
    expect(proposal.nodes[1]).toMatchObject({
      display_level: 1,
      include_in_toc: true,
      starts_page: true,
    });
    expect(proposal.nodes[1]?.display_title).toBeUndefined();
  });

  it("does not include unrecognized frontmatter headings before a numbered book", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## Cover Title",
          "",
          "## Copyright Metadata",
          "",
          "## 1 Introduction",
          "",
          "正文",
        ].join("\n"),
      ),
    );

    expect(
      proposeDocumentStructure(document).nodes.map(
        (node) => node.include_in_toc,
      ),
    ).toEqual([false, false, true]);
  });

  it("propagates a matched printed appendix role without a manual role field", () => {
    const source = [
      "## 附录 1 数据来源 ........ 99",
      "",
      "## 本书中用到的数据来源",
      "",
      "正文",
    ].join("\n");
    const document = normalizeDocumentBlocks(parseMarkdownDocument(source));
    const entryStart = Buffer.from(
      source.slice(0, source.indexOf("附录")),
      "utf8",
    ).byteLength;
    const entryEnd =
      entryStart +
      Buffer.from("附录 1 数据来源 ........ 99", "utf8").byteLength;
    const bodyHeading = document.headings[1];
    expect(bodyHeading).toBeDefined();
    if (!bodyHeading) throw new Error("expected body heading");

    const proposal = proposeDocumentStructure(document, {
      sourceRegions: [
        {
          applied: true,
          disposition: "reference_only",
          entries: [
            {
              body_heading_block_id: bodyHeading.blockId,
              range: {
                end_byte: entryEnd,
                sha256: "a".repeat(64),
                start_byte: entryStart,
              },
              reference_level: 1,
            },
          ],
          kind: "printed_toc",
          range: {
            end_byte: entryEnd,
            sha256: "b".repeat(64),
            start_byte: entryStart,
          },
          region_id: "region_0123456789abcdef",
          source_path: "book.md",
          source_sha256: "c".repeat(64),
        },
      ],
    });

    expect(proposal.nodes[1]).toMatchObject({
      display_level: 1,
      include_in_toc: true,
      role: "appendix",
    });
  });

  it("keeps an unmatched learning objective in body but out of navigation", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        ["## 1 导论", "", "正文", "", "## 学习目标", "", "目标正文"].join("\n"),
      ),
    );

    expect(proposeDocumentStructure(document).nodes[1]).toMatchObject({
      include_in_toc: false,
      starts_page: false,
    });
  });

  it("joins an adjacent short MinerU heading fragment for navigation", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## 第2章 交换",
          "",
          "正文",
          "",
          "## 2.8 从个人贸易到国际贸易，再回到个人贸",
          "",
          "## 易",
          "",
          "正文",
        ].join("\n"),
      ),
    );

    const proposal = proposeDocumentStructure(document);
    expect(proposal.nodes[1]).toMatchObject({
      display_title: "2.8 从个人贸易到国际贸易，再回到个人贸易",
      include_in_toc: true,
      starts_page: false,
    });
    expect(proposal.nodes[2]).toMatchObject({
      display_level: 2,
      include_in_toc: false,
      starts_page: false,
    });
  });

  it("closes inferred level gaps", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        "# 第1章 基础\n\n正文\n\n## 1.1.1 跳级识别\n\n正文\n",
      ),
    );

    expect(
      proposeDocumentStructure(document).nodes.map(
        (node) => node.display_level,
      ),
    ).toEqual([1, 2]);
  });

  it("splits parts, later nested chapters and appendices independently of levels", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## 第一部分 系统基础",
          "",
          "## 第1章 起步",
          "",
          "正文",
          "",
          "## 1.1 基本概念",
          "",
          "正文",
          "",
          "## 第2章 深入",
          "",
          "正文",
          "",
          "## 2.1 实现",
          "",
          "正文",
          "",
          "## 附录 A 数据表",
          "",
          "正文",
        ].join("\n"),
      ),
    );

    const proposal = proposeDocumentStructure(document);
    expect(proposal.nodes.map((node) => node.display_level)).toEqual([
      1, 2, 3, 2, 3, 1,
    ]);
    expect(proposal.nodes.map((node) => node.starts_page)).toEqual([
      true,
      false,
      false,
      true,
      false,
      true,
    ]);
  });

  it("includes clear unnumbered front and back units around numbered body headings", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## 前言",
          "",
          "正文",
          "",
          "## 第1章 基础",
          "",
          "正文",
          "",
          "## 1.1 起步",
          "",
          "正文",
          "",
          "## 旁注",
          "",
          "正文",
          "",
          "## 参考文献",
          "",
          "正文",
        ].join("\n"),
      ),
    );

    const proposal = proposeDocumentStructure(document);
    expect(proposal.nodes.map((node) => node.include_in_toc)).toEqual([
      true,
      true,
      true,
      false,
      true,
    ]);
    expect(proposal.nodes.map((node) => node.role)).toEqual([
      "frontmatter",
      "body",
      undefined,
      undefined,
      "backmatter",
    ]);
    expect(proposal.nodes.map((node) => node.starts_page)).toEqual([
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it("starts later chapters at their own heading rather than at the first section", () => {
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(
        [
          "## 第1章 基础",
          "",
          "正文",
          "",
          "## 1.1 起步",
          "",
          "正文",
          "",
          "## 第2章 进阶",
          "",
          "正文",
          "",
          "## 2.1 深入",
          "",
          "正文",
        ].join("\n"),
      ),
    );

    expect(
      proposeDocumentStructure(document).nodes.map((node) => node.starts_page),
    ).toEqual([true, false, true, false]);
  });
});
