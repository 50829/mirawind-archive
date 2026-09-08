import { describe, expect, it } from "vitest";

import { analysisDocument } from "../../helpers/analysis-document";
import { parseEditorDocument } from "@/modules/publishing/core/content/editor-parser";
import { proposeDocumentStructure } from "@/modules/publishing/core/preparation/structure-proposal";

function requireAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`expected item at index ${index}`);
  return value;
}

function proposalRoles(
  proposal: ReturnType<typeof proposeDocumentStructure>,
): readonly ("appendix" | "backmatter" | "body" | "frontmatter")[] {
  const indexById = new Map(
    proposal.nodes.map((node, index) => [node.block_id, index] as const),
  );
  const body = indexById.get(proposal.boundaries.body_start_block_id) ?? 0;
  const appendix = proposal.boundaries.appendix_start_block_id
    ? indexById.get(proposal.boundaries.appendix_start_block_id)
    : undefined;
  const backmatter = proposal.boundaries.backmatter_start_block_id
    ? indexById.get(proposal.boundaries.backmatter_start_block_id)
    : undefined;
  return proposal.nodes.map((_, index) => {
    if (backmatter !== undefined && index >= backmatter) return "backmatter";
    if (appendix !== undefined && index >= appendix) return "appendix";
    return index < body ? "frontmatter" : "body";
  });
}

describe("default document structure proposal", () => {
  it("keeps technical decimal text as title content", () => {
    const document = analysisDocument(
      parseEditorDocument("# 8.5英寸软盘\n\n正文"),
    );

    expect(proposeDocumentStructure(document).nodes[0]).toMatchObject({
      title_markdown: "8.5英寸软盘",
    });
    expect(proposeDocumentStructure(document).nodes[0]).not.toHaveProperty(
      "source_number",
    );
  });

  it("separates a rich Markdown source number exactly once", () => {
    const document = analysisDocument(
      parseEditorDocument("# **4.4.4** Virtual memory\n\nBody"),
    );

    expect(proposeDocumentStructure(document).nodes[0]).toMatchObject({
      source_number: "4.4.4",
      title_markdown: "Virtual memory",
    });
  });

  it("keeps cover metadata before numbered chapters out of navigation", () => {
    const document = analysisDocument(
      parseEditorDocument(
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
    expect(proposalRoles(proposeDocumentStructure(document))).toEqual([
      "frontmatter",
      "frontmatter",
      "frontmatter",
      "frontmatter",
      "body",
    ]);
  });

  it("starts the body at a numbered section when its chapter heading is missing", () => {
    const document = analysisDocument(
      parseEditorDocument(
        "# Book Title\n\n## Chapter 1 Overview\n\n## Preface\n\nText\n\n## 1.1 Opening\n\nBody\n\n## Chapter 2 Next\n",
      ),
    );
    const firstBodySection = document.headings[3];
    if (!firstBodySection) throw new Error("missing first body section");

    expect(
      proposalRoles(
        proposeDocumentStructure(document, {
          bodySearchStartBlockId: firstBodySection.blockId,
        }),
      ),
    ).toEqual(["frontmatter", "frontmatter", "frontmatter", "body", "body"]);
  });

  it("carries appendix and backmatter roles through unnumbered units", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "# Chapter 1 Body",
          "",
          "Body",
          "",
          "# Appendix",
          "",
          "Appendix body",
          "",
          "# Tables",
          "",
          "Tables body",
          "",
          "# References",
          "",
          "References body",
          "",
          "# Series",
        ].join("\n"),
      ),
    );

    expect(proposalRoles(proposeDocumentStructure(document))).toEqual([
      "body",
      "appendix",
      "appendix",
      "backmatter",
      "backmatter",
    ]);
  });

  it("treats named author and subject indexes as top-level backmatter", () => {
    const document = analysisDocument(
      parseEditorDocument(
        "# 1 Body\n\nBody\n\n# Author Index\n\nNames\n\n# Subject Index\n",
      ),
    );

    const proposal = proposeDocumentStructure(document);
    const roles = proposalRoles(proposal);
    expect(
      proposal.nodes.map((node, index) => ({
        level: node.display_level,
        role: roles[index],
        starts: node.starts_page,
      })),
    ).toEqual([
      { level: 1, role: "body", starts: true },
      { level: 1, role: "backmatter", starts: true },
      { level: 1, role: "backmatter", starts: true },
    ]);
  });

  it("resets a carried role at a detached numeric chapter marker", () => {
    const document = analysisDocument(
      parseEditorDocument(
        "# References\n\nReference body\n\n# 1\n\n# 导论\n\nBody\n",
      ),
    );

    expect(proposalRoles(proposeDocumentStructure(document))).toEqual([
      "frontmatter",
      "body",
      "body",
    ]);
  });

  it("resets a carried role at a nested chapter", () => {
    const document = analysisDocument(
      parseEditorDocument(
        "# References\n\nReference body\n\n## Chapter 1 Start\n\nBody\n",
      ),
    );

    expect(proposalRoles(proposeDocumentStructure(document))).toEqual([
      "frontmatter",
      "body",
    ]);
  });

  it("resets inherited role without emitting role on a chapter nested in a part", () => {
    const document = analysisDocument(
      parseEditorDocument("# Part One\n\n# Chapter One\n\nData\n"),
    );
    const part = requireAt(document.headings, 0);
    const chapter = requireAt(document.headings, 1);

    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: part.blockId,
          referenceLevel: 1,
          sourceTitle: "Part I",
        },
        {
          bodyHeadingBlockId: chapter.blockId,
          referenceLevel: 2,
          sourceTitle: "Chapter 1",
        },
      ],
    });

    expect(proposal.nodes).toMatchObject([
      { display_level: 1 },
      { display_level: 2 },
    ]);
    expect(proposalRoles(proposal)).toEqual(["body", "body"]);
  });

  it("resets a carried role from a matched printed chapter", () => {
    const source = [
      "# References",
      "",
      "Reference body",
      "",
      "Chapter 1 Introduction ........ 1",
      "",
      "## Introduction",
      "",
      "Body",
    ].join("\n");
    const document = analysisDocument(parseEditorDocument(source));
    const chapter = document.headings[1];
    if (!chapter) throw new Error("expected chapter heading");
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: chapter.blockId,
          referenceLevel: 2,
          sourceTitle: "Chapter 1 Introduction ........ 1",
        },
      ],
    });

    expect(proposalRoles(proposal)).toEqual(["frontmatter", "body"]);
    expect(proposal.nodes.map((node) => node.display_level)).toEqual([1, 1]);
  });

  it("keeps heading order, closes level gaps and starts only major units on pages", () => {
    const normalized = analysisDocument(
      parseEditorDocument(
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
    expect(proposalRoles(proposal)).toEqual([
      "frontmatter",
      "frontmatter",
      "frontmatter",
      "body",
      "body",
      "appendix",
      "appendix",
      "backmatter",
    ]);
    expect(proposal.nodes.every((node) => node.include_in_toc)).toBe(true);
  });

  it("does not mutate source or normalized headings", () => {
    const document = analysisDocument(
      parseEditorDocument("# One\n\n### Three"),
    );
    const before = JSON.stringify(document);

    proposeDocumentStructure(document);

    expect(JSON.stringify(document)).toBe(before);
  });

  it("keeps a chapter whole when there is no second-level heading", () => {
    const document = analysisDocument(
      parseEditorDocument("# One\n\nText\n\n# Two\n\nText"),
    );

    expect(
      proposeDocumentStructure(document).nodes.map((node) => node.starts_page),
    ).toEqual([true, true]);
  });

  it("uses printed nesting instead of flat MinerU H2 levels", () => {
    const document = analysisDocument(
      parseEditorDocument(
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
    const proposal = proposeDocumentStructure(document, {
      printedEntries: document.headings.map((heading, index) => ({
        bodyHeadingBlockId: heading.blockId,
        referenceLevel: index === 0 ? 1 : 2,
        sourceTitle: heading.sourceTitle,
      })),
    });
    expect(proposal.nodes.map((node) => node.display_level)).toEqual([1, 2, 2]);
    expect(proposal.nodes.map((node) => node.starts_page)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("carries an inferred part offset into body-only descendants", () => {
    const document = analysisDocument(
      parseEditorDocument(
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
    expect(
      proposeDocumentStructure(document, {
        printedEntries: [
          {
            bodyHeadingBlockId: chapter.blockId,
            referenceLevel: 2,
            sourceTitle: chapter.sourceTitle,
          },
          {
            bodyHeadingBlockId: section.blockId,
            referenceLevel: 3,
            sourceTitle: section.sourceTitle,
          },
        ],
      }).nodes.map((node) => node.display_level),
    ).toEqual([1, 1, 2, 3]);
  });

  it("shifts descendants when a canonical chapter has no body heading", () => {
    const printed = [
      "第二部分 理论",
      "第7章 已识别章 ...... 100",
      "7.1 已识别节 ...... 101",
      "第8章 缺失章 ...... 120",
      "8.1 缺失章下的节 ...... 121",
    ];
    const source = [
      ...printed,
      "",
      "## 第二部分 理论",
      "",
      "## 第7章 已识别章",
      "",
      "## 7.1 已识别节",
      "",
      "## 7.1.1 正常子节",
      "",
      "## 8.1 缺失章下的节",
      "",
      "## 8.1.1 上移子节",
    ].join("\n");
    const document = analysisDocument(parseEditorDocument(source));
    const [part, chapter, firstSection, , missingChapterSection] =
      document.headings;
    if (!part || !chapter || !firstSection || !missingChapterSection) {
      throw new Error("expected body headings");
    }
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: part.blockId,
          referenceLevel: 1,
          sourceTitle: requireAt(printed, 0),
        },
        {
          bodyHeadingBlockId: chapter.blockId,
          referenceLevel: 2,
          sourceTitle: requireAt(printed, 1),
        },
        {
          bodyHeadingBlockId: firstSection.blockId,
          referenceLevel: 3,
          sourceTitle: requireAt(printed, 2),
        },
        { referenceLevel: 2, sourceTitle: requireAt(printed, 3) },
        {
          bodyHeadingBlockId: missingChapterSection.blockId,
          referenceLevel: 3,
          sourceTitle: requireAt(printed, 4),
        },
      ],
    });

    expect(proposal.nodes.map((node) => node.display_level)).toEqual([
      1, 2, 3, 4, 2, 3,
    ]);
  });

  it("keeps part nesting when a printed entry did not match its body heading", () => {
    const document = analysisDocument(
      parseEditorDocument(
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
    const document = analysisDocument(
      parseEditorDocument(
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
    const document = analysisDocument(
      parseEditorDocument(
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
      include_in_toc: true,
      source_number: "第一部分",
      title_markdown: "程序结构和执行",
    });
    expect(proposal.nodes[1]).toMatchObject({
      display_level: 1,
      include_in_toc: false,
      starts_page: false,
    });
  });

  it("keeps adjacent body headings when the printed part maps to the subtitle", () => {
    const document = analysisDocument(
      parseEditorDocument(
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
    const subtitle = document.headings[1];
    if (!subtitle) throw new Error("expected part subtitle");

    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: subtitle.blockId,
          referenceLevel: 1,
          sourceTitle: "第一部分 程序结构和执行",
        },
      ],
    });

    expect(proposal.nodes).toMatchObject([
      {
        display_level: 1,
        include_in_toc: true,
        starts_page: true,
      },
      {
        display_level: 1,
        include_in_toc: true,
        starts_page: true,
      },
    ]);
    expect(proposal.nodes[0]?.title_markdown).toBe("第一部分");
    expect(proposal.nodes[1]?.title_markdown).toBe("程序结构和执行");
  });

  it("keeps a detached Chinese chapter marker and splits on its title", () => {
    const document = analysisDocument(
      parseEditorDocument("## 第3章\n\n# 程序的机器级表示\n\n正文"),
    );
    const [, chapterTitle] = document.headings;
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: chapterTitle?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "第3章 程序的机器级表示",
        },
      ],
    });

    expect(proposal.nodes).toMatchObject([
      {
        display_level: 1,
        include_in_toc: true,
        starts_page: true,
      },
      {
        display_level: 1,
        include_in_toc: true,
        starts_page: true,
      },
    ]);
  });

  it("treats an ambiguous multi-digit gap as a chapter without forcing a match", () => {
    const document = analysisDocument(
      parseEditorDocument(
        "## 12.7.3 Previous\n\n正文\n\n## 12 7.4 Competition",
      ),
    );
    const proposal = proposeDocumentStructure(document);

    expect(proposal.nodes[1]).toMatchObject({
      display_level: 1,
      include_in_toc: true,
      starts_page: true,
    });
  });

  it("keeps appendix descendants in their continuous hierarchy", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## 错误处理",
          "",
          "正文",
          "",
          "## A. 1 Unix 系统中的错误处理",
          "",
          "## 1. Unix 风格的错误处理",
          "",
          "## A.2 错误处理包装函数",
          "",
          "## 参考文献",
        ].join("\n"),
      ),
    );
    const [appendix, , , , references] = document.headings;
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: appendix?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "附录 A 错误处理",
        },
        {
          bodyHeadingBlockId: references?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "参考文献",
        },
      ],
    });

    expect(
      proposal.nodes.map((node) => ({
        include_in_toc: node.include_in_toc,
        level: node.display_level,
      })),
    ).toEqual([
      { include_in_toc: true, level: 1 },
      { include_in_toc: false, level: 2 },
      { include_in_toc: false, level: 3 },
      { include_in_toc: false, level: 2 },
      { include_in_toc: true, level: 1 },
    ]);
  });

  it("keeps a detached English part label level with its canonical title", () => {
    const document = analysisDocument(
      parseEditorDocument(
        "# Preface\n\nFront matter.\n\n# Part One\n\n# Overview\n\nBody.\n",
      ),
    );
    const overview = document.headings[2];
    if (!overview) throw new Error("expected overview heading");

    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: overview.blockId,
          referenceLevel: 1,
          sourceTitle: "PART ONE OVERVIEW",
        },
      ],
    });

    expect(proposal.nodes.slice(1)).toMatchObject([
      {
        display_level: 1,
        include_in_toc: false,
        starts_page: false,
      },
      {
        display_level: 1,
        include_in_toc: true,
        starts_page: true,
      },
    ]);
  });

  it("joins a detached numeric chapter marker into the following title", () => {
    const document = analysisDocument(
      parseEditorDocument(
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
    expect(proposal.nodes[1]?.title_markdown).toBe("导论");
  });

  it("does not include unrecognized frontmatter headings before a numbered book", () => {
    const document = analysisDocument(
      parseEditorDocument(
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
    const document = analysisDocument(parseEditorDocument(source));
    const bodyHeading = document.headings[1];
    expect(bodyHeading).toBeDefined();
    if (!bodyHeading) throw new Error("expected body heading");

    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: bodyHeading.blockId,
          referenceLevel: 1,
          sourceTitle: "附录 1 数据来源 ........ 99",
        },
      ],
    });

    expect(proposal.nodes[1]).toMatchObject({
      display_level: 1,
      include_in_toc: true,
    });
    expect(proposalRoles(proposal)).toEqual(["body", "appendix"]);
  });

  it("uses transient logical-entry semantics when Markdown provenance is damaged", () => {
    const document = analysisDocument(
      parseEditorDocument("## 本书中用到的数据来源\n\n正文"),
    );
    const heading = document.headings[0];
    if (!heading) throw new Error("expected body heading");

    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: heading.blockId,
          referenceLevel: 1,
          sourceTitle: "附录 1 数据来源 ...... 99",
        },
      ],
    });

    expect(proposal.nodes[0]).toMatchObject({
      display_level: 1,
      include_in_toc: true,
    });
    expect(proposalRoles(proposal)).toEqual(["body"]);
  });

  it("keeps a nested printed appendix inside the body role", () => {
    const source = [
      "## Chapter 4 Models",
      "",
      "正文",
      "",
      "附录 4.1 Derivation ...... 99",
      "",
      "## Derivation",
      "",
      "正文",
      "",
      "## Exercises",
    ].join("\n");
    const document = analysisDocument(parseEditorDocument(source));
    const bodyHeading = document.headings[1];
    if (!bodyHeading) throw new Error("expected appendix heading");
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: bodyHeading.blockId,
          referenceLevel: 2,
          sourceTitle: "附录 4.1 Derivation ...... 99",
        },
      ],
    });

    expect(proposalRoles(proposal)).toEqual(["body", "body", "body"]);
    expect(proposal.nodes[1]?.starts_page).toBe(true);
  });

  it("keeps an unmatched learning objective in body but out of navigation", () => {
    const document = analysisDocument(
      parseEditorDocument(
        ["## 1 导论", "", "正文", "", "## 学习目标", "", "目标正文"].join("\n"),
      ),
    );

    expect(proposeDocumentStructure(document).nodes[1]).toMatchObject({
      include_in_toc: false,
      starts_page: false,
    });
  });

  it("nests local headings below the last canonical section", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## 第1章 基础",
          "",
          "### 1.1 起步",
          "",
          "#### 课后习题和问题",
          "",
          "## 复习题",
          "",
          "# 1.1 节",
          "",
          "### 1. HTTP/2 成帧",
          "",
          "正文",
        ].join("\n"),
      ),
    );
    const [chapter, section, review, reviewChild] = document.headings;
    expect(chapter && section && review && reviewChild).toBeTruthy();

    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: chapter?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "第1章 基础",
        },
        {
          bodyHeadingBlockId: section?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "1.1 起步",
        },
        {
          bodyHeadingBlockId: review?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "课后习题和问题",
        },
        {
          bodyHeadingBlockId: reviewChild?.blockId ?? "",
          referenceLevel: 3,
          sourceTitle: "复习题",
        },
      ],
    });

    expect(proposal.nodes.slice(4).map((node) => node.display_level)).toEqual([
      4, 4,
    ]);
    expect(proposal.nodes.slice(4).map((node) => node.include_in_toc)).toEqual([
      false,
      false,
    ]);
  });

  it("nests local headings below the last canonical h2 level", () => {
    const document = analysisDocument(
      parseEditorDocument(
        ["## 第1章 基础", "", "## 1.1 起步", "", "## 局部说明"].join("\n"),
      ),
    );
    const [chapter, section] = document.headings;

    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: chapter?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "第1章 基础",
        },
        {
          bodyHeadingBlockId: section?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "1.1 起步",
        },
      ],
    });

    expect(proposal.nodes[2]).toMatchObject({
      display_level: 3,
      include_in_toc: false,
    });
  });

  it("keeps chapter-local bibliography at the canonical section level", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## Chapter 1 Start",
          "",
          "## 1.1 Topic",
          "",
          "## Bibliography",
          "",
          "## Chapter 2 Continue",
        ].join("\n"),
      ),
    );
    const [firstChapter, section, bibliography, secondChapter] =
      document.headings;
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: firstChapter?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "Chapter 1 Start",
        },
        {
          bodyHeadingBlockId: section?.blockId ?? "",
          referenceLevel: 3,
          sourceTitle: "1.1 Topic",
        },
        {
          bodyHeadingBlockId: bibliography?.blockId ?? "",
          referenceLevel: 3,
          sourceTitle: "Bibliography",
        },
        {
          bodyHeadingBlockId: secondChapter?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "Chapter 2 Continue",
        },
      ],
    });

    expect(proposal.nodes[2]).toMatchObject({
      display_level: 3,
      include_in_toc: true,
    });
  });

  it("keeps chapter-local appendix headings on their parent reading unit", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## 5.9 Topic",
          "",
          "Body",
          "",
          "## Appendix: Local details",
          "",
          "Body",
          "",
          "## Appendix: Supporting table",
        ].join("\n"),
      ),
    );
    const [section, appendix, child] = document.headings;
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: section?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "5.9 Topic",
        },
        {
          bodyHeadingBlockId: appendix?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "Appendix: Local details",
        },
        {
          bodyHeadingBlockId: child?.blockId ?? "",
          referenceLevel: 3,
          sourceTitle: "Appendix: Supporting table",
        },
      ],
    });

    expect(proposal.nodes.slice(1).map((node) => node.starts_page)).toEqual([
      false,
      false,
    ]);
  });

  it("hides a detached numeric marker before a matched English chapter", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## 4 Previous chapter",
          "",
          "## 4.1 Previous section",
          "",
          "## Exercises",
          "",
          "## 5",
          "",
          "## Basis Expansions and Regularization",
        ].join("\n"),
      ),
    );
    const [previousChapter, previousSection, exercises, , chapter] =
      document.headings;
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: previousChapter?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "4 Previous chapter",
        },
        {
          bodyHeadingBlockId: previousSection?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "4.1 Previous section",
        },
        {
          bodyHeadingBlockId: exercises?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "Exercises",
        },
        {
          bodyHeadingBlockId: chapter?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "5 Basis Expansions and Regularization",
        },
      ],
    });

    expect(proposal.nodes.slice(3)).toMatchObject([
      {
        display_level: 1,
        include_in_toc: false,
        starts_page: false,
      },
      {
        display_level: 1,
        include_in_toc: true,
        starts_page: true,
      },
    ]);
  });

  it("keeps a detached numeric marker level with its chapter title", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## 1.1 Topic",
          "",
          "## 1.1.1 Detail",
          "",
          "## 2",
          "",
          "## Next Chapter",
        ].join("\n"),
      ),
    );
    const [section, detail, , chapter] = document.headings;
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: section?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "1.1 Topic",
        },
        {
          bodyHeadingBlockId: detail?.blockId ?? "",
          referenceLevel: 3,
          sourceTitle: "1.1.1 Detail",
        },
        {
          bodyHeadingBlockId: chapter?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "Chapter 2 Next Chapter",
        },
      ],
    });

    expect(proposal.nodes[2]).toMatchObject({
      display_level: 1,
      include_in_toc: false,
      starts_page: false,
    });
  });

  it("keeps a detached Chinese numeric marker below prior section context", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## 1.1 Previous section",
          "",
          "## Exercises",
          "",
          "## 2",
          "",
          "## 数学和统计基础",
        ].join("\n"),
      ),
    );
    const [section, exercises, , chapter] = document.headings;
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: section?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "1.1 Previous section",
        },
        {
          bodyHeadingBlockId: exercises?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "Exercises",
        },
        {
          bodyHeadingBlockId: chapter?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "第 2 章 数学和统计基础",
        },
      ],
    });

    expect(proposal.nodes[2]).toMatchObject({
      display_level: 3,
      include_in_toc: false,
      starts_page: false,
    });
    expect(proposal.nodes[3]).toMatchObject({
      display_level: 1,
      include_in_toc: true,
      starts_page: true,
    });
  });

  it("splits a matched Chinese appendix as a major local reading unit", () => {
    const document = analysisDocument(
      parseEditorDocument(
        "## 3.16 Previous section\n\nBody\n\n## 附录:数学推导\n",
      ),
    );
    const [section, appendix] = document.headings;
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: section?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "3.16 Previous section",
        },
        {
          bodyHeadingBlockId: appendix?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "附录:数学推导",
        },
      ],
    });

    expect(proposal.nodes[1]).toMatchObject({
      display_level: 2,
      include_in_toc: true,
      starts_page: true,
    });
  });

  it("keeps explicit backmatter visible after a matched appendix", () => {
    const document = analysisDocument(
      parseEditorDocument(
        "## Appendix B Tables\n\nBody\n\n## Bibliography\n\nSources\n",
      ),
    );
    const appendix = document.headings[0];
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: appendix?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "Appendix B Tables",
        },
      ],
    });

    expect(proposal.nodes[1]).toMatchObject({
      display_level: 1,
      include_in_toc: true,
    });
    expect(proposalRoles(proposal)).toEqual(["body", "backmatter"]);
  });

  it("classifies a matched author biography as frontmatter", () => {
    const document = analysisDocument(
      parseEditorDocument("## 作者简介\n\n正文\n\n## 第1章 起步\n\n正文"),
    );
    const [biography, chapter] = document.headings;
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: biography?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "作者简介",
        },
        {
          bodyHeadingBlockId: chapter?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "第1章 起步",
        },
      ],
    });

    expect(proposalRoles(proposal)).toEqual(["frontmatter", "body"]);
    expect(proposal.nodes.map((node) => node.starts_page)).toEqual([
      true,
      true,
    ]);
  });

  it("does not invent a display-title override from a short heading fragment", () => {
    const document = analysisDocument(
      parseEditorDocument(
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
      include_in_toc: true,
      starts_page: false,
    });
    expect(proposal.nodes[1]?.title_markdown).toBe(
      "从个人贸易到国际贸易，再回到个人贸",
    );
    expect(proposal.nodes[1]?.source_number).toBe("2.8");
    expect(proposal.nodes[2]).toMatchObject({
      display_level: 2,
      include_in_toc: false,
      starts_page: false,
    });
  });

  it("closes inferred level gaps", () => {
    const document = analysisDocument(
      parseEditorDocument(
        "# 第1章 基础\n\n正文\n\n## 1.1.1 跳级识别\n\n正文\n",
      ),
    );

    expect(
      proposeDocumentStructure(document).nodes.map(
        (node) => node.display_level,
      ),
    ).toEqual([1, 2]);
  });

  it("preserves section depth when its printed chapter heading is missing", () => {
    const document = analysisDocument(
      parseEditorDocument("# Preface\n\n## 1.1 First section\n\nBody\n"),
    );

    expect(
      proposeDocumentStructure(document, {
        printedEntries: [
          {
            referenceLevel: 1,
            sourceTitle: "Chapter 1 Missing heading",
          },
        ],
      }).nodes.map((node) => node.display_level),
    ).toEqual([1, 2]);
  });

  it("collapses descendants when a nested printed chapter heading is missing", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## Part One",
          "",
          "## Chapter 7 Previous",
          "",
          "## 7.1 Previous section",
          "",
          "## 8.1 First section",
          "",
          "## 8.1.1 First detail",
          "",
          "## 8.1.2 Second detail",
          "",
          "## 8.2 Second section",
          "",
          "## 8.2.1 Third detail",
        ].join("\n"),
      ),
    );
    const [part, chapter, previousSection, firstSection, , , secondSection] =
      document.headings;

    expect(
      proposeDocumentStructure(document, {
        printedEntries: [
          {
            bodyHeadingBlockId: part?.blockId ?? "",
            referenceLevel: 1,
            sourceTitle: "Part One",
          },
          {
            bodyHeadingBlockId: chapter?.blockId ?? "",
            referenceLevel: 2,
            sourceTitle: "Chapter 7 Previous",
          },
          {
            bodyHeadingBlockId: previousSection?.blockId ?? "",
            referenceLevel: 3,
            sourceTitle: "7.1 Previous section",
          },
          {
            referenceLevel: 2,
            sourceTitle: "Chapter 8 Missing heading",
          },
          {
            bodyHeadingBlockId: firstSection?.blockId ?? "",
            referenceLevel: 3,
            sourceTitle: "8.1 First section",
          },
          {
            bodyHeadingBlockId: secondSection?.blockId ?? "",
            referenceLevel: 3,
            sourceTitle: "8.2 Second section",
          },
        ],
      }).nodes.map((node) => node.display_level),
    ).toEqual([1, 2, 3, 2, 3, 3, 2, 3]);
  });

  it("preserves printed depth when an unmatched body heading fills the chapter gap", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## Part One",
          "",
          "## Storage structures",
          "",
          "## 8.1 First section",
          "",
          "## 8.1.1 First detail",
          "",
          "## 8.2 Second section",
          "",
          "## 8.2.1 Second detail",
        ].join("\n"),
      ),
    );
    const [part, , firstSection, , secondSection] = document.headings;

    expect(
      proposeDocumentStructure(document, {
        printedEntries: [
          {
            bodyHeadingBlockId: part?.blockId ?? "",
            referenceLevel: 1,
            sourceTitle: "Part One",
          },
          {
            referenceLevel: 2,
            sourceTitle: "Chapter 8 Missing heading",
          },
          {
            bodyHeadingBlockId: firstSection?.blockId ?? "",
            referenceLevel: 3,
            sourceTitle: "8.1 First section",
          },
          {
            bodyHeadingBlockId: secondSection?.blockId ?? "",
            referenceLevel: 3,
            sourceTitle: "8.2 Second section",
          },
        ],
      }).nodes.map((node) => node.display_level),
    ).toEqual([1, 1, 2, 3, 3, 4]);
  });

  it("restores a nested chapter after an unlisted top-level appendix", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## Part One",
          "",
          "Body",
          "",
          "## Appendix A Answers",
          "",
          "Answers",
          "",
          "## Chapter 7 Portfolio selection",
          "",
          "Body",
          "",
          "## 7.1 Diversification",
          "",
          "Body",
        ].join("\n"),
      ),
    );
    const [part, , chapter, section] = document.headings;

    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: part?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "Part One",
        },
        {
          bodyHeadingBlockId: chapter?.blockId ?? "",
          referenceLevel: 2,
          sourceTitle: "Chapter 7 Portfolio selection",
        },
        {
          bodyHeadingBlockId: section?.blockId ?? "",
          referenceLevel: 3,
          sourceTitle: "7.1 Diversification",
        },
      ],
    });

    expect(proposal.nodes.map((node) => node.display_level)).toEqual([
      1, 1, 2, 3,
    ]);
    expect(proposalRoles(proposal)).toEqual(["body", "body", "body", "body"]);
  });

  it("splits parts, later nested chapters and appendices independently of levels", () => {
    const document = analysisDocument(
      parseEditorDocument(
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
    const document = analysisDocument(
      parseEditorDocument(
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
    expect(proposalRoles(proposal)).toEqual([
      "frontmatter",
      "body",
      "body",
      "body",
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

  it("treats acknowledgements before the first printed chapter as frontmatter", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## 专家指导委员会",
          "",
          "正文",
          "",
          "## 第2版前言",
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
        ].join("\n"),
      ),
    );
    const printedTitles = ["专家指导委员会", "第2版前言", "致谢", "第1章 开始"];
    const printedEntries = document.headings.map((heading, index) => {
      const sourceTitle = printedTitles[index];
      if (!sourceTitle) throw new Error("PRINTED_TITLE_MISSING");
      return {
        bodyHeadingBlockId: heading.blockId,
        referenceLevel: 1,
        sourceTitle,
      };
    });

    const proposal = proposeDocumentStructure(document, { printedEntries });

    expect(proposalRoles(proposal)).toEqual([
      "frontmatter",
      "frontmatter",
      "frontmatter",
      "body",
    ]);
    expect(proposal.nodes.map((node) => node.starts_page)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("strips a printed page suffix before classifying frontmatter", () => {
    const document = analysisDocument(
      parseEditorDocument("## 致谢\n\n正文\n\n## 第1章 开始\n\n正文"),
    );
    const [acknowledgements, chapter] = document.headings;
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: acknowledgements?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "致谢 ...... xii",
        },
        {
          bodyHeadingBlockId: chapter?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "第1章 开始 ...... 1",
        },
      ],
    });

    expect(proposalRoles(proposal)).toEqual(["frontmatter", "body"]);
  });

  it("counts raw HTML as body when splitting adjacent backmatter units", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## 图片来源",
          "",
          "来源正文",
          "",
          "## 符号索引",
          "",
          "<table><tr><td>符号</td></tr></table>",
          "",
          "## 索引",
          "",
          "索引正文",
        ].join("\n"),
      ),
    );

    expect(
      proposeDocumentStructure(document).nodes.map((node) => node.starts_page),
    ).toEqual([true, true, true]);
  });

  it("does not split a matched exercise heading with OCR wrapper artifacts", () => {
    const source = "## 第1章 开始\n\n正文\n\n## K习题 1Ck\n\n练习正文";
    const document = analysisDocument(parseEditorDocument(source));
    const [chapter, exercises] = document.headings;
    if (!chapter || !exercises) throw new Error("expected headings");
    const proposal = proposeDocumentStructure(document, {
      printedEntries: [
        {
          bodyHeadingBlockId: chapter?.blockId ?? "",
          referenceLevel: 1,
          sourceTitle: "第1章 开始 ...... 1",
        },
        {
          bodyHeadingBlockId: exercises?.blockId ?? "",
          referenceLevel: 3,
          sourceTitle: "习题 1C ...... 20",
        },
      ],
    });

    expect(proposal.nodes[1]).toMatchObject({
      include_in_toc: true,
      starts_page: false,
    });
  });

  it("classifies edition-specific English prefaces as frontmatter", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## Preface to the Second Edition",
          "",
          "Front matter.",
          "",
          "## Preface to the First Edition",
          "",
          "Front matter.",
          "",
          "## 1 Introduction",
          "",
          "Body.",
        ].join("\n"),
      ),
    );

    expect(proposalRoles(proposeDocumentStructure(document))).toEqual([
      "frontmatter",
      "frontmatter",
      "body",
    ]);
  });

  it("keeps audience notes before the first chapter in frontmatter", () => {
    const document = analysisDocument(
      parseEditorDocument(
        [
          "## 译者序",
          "",
          "## 致学生",
          "",
          "## 致教师",
          "",
          "## 第1章 开始",
          "",
          "正文",
        ].join("\n"),
      ),
    );

    expect(proposalRoles(proposeDocumentStructure(document))).toEqual([
      "frontmatter",
      "frontmatter",
      "frontmatter",
      "body",
    ]);
  });

  it("starts later chapters at their own heading rather than at the first section", () => {
    const document = analysisDocument(
      parseEditorDocument(
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
