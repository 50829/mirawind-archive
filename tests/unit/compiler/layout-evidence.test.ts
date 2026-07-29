import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  readMineruLayoutEvidence,
  reconstructPrintedLayoutRows,
  supplementMissingListPageLabels,
  type LayoutEvidence,
} from "@/compiler/document/layout-evidence";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "layout-evidence-"));
  roots.push(root);
  await writeFile(join(root, "book.md"), "# Book\n");
  return root;
}

describe("bounded MinerU layout evidence", () => {
  it("projects only bounded flat fields", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "book_content_list.json"),
      JSON.stringify([
        {
          bbox: [10, 20, 100, 40],
          page_idx: 3,
          text: "1.1 Section .... 8",
          text_level: 2,
          type: "text",
          unknown: "ignored",
        },
      ]),
    );

    await expect(
      readMineruLayoutEvidence(join(root, "book.md")),
    ).resolves.toEqual({
      diagnostics: [],
      records: [
        {
          bbox: [10, 20, 100, 40],
          pageIndex: 3,
          sourceOrder: 0,
          text: "1.1 Section .... 8",
          textLevel: 2,
          type: "text",
        },
      ],
      source: "content-list",
    });
  });

  it("expands list items without inventing per-item boxes", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "book_content_list.json"),
      JSON.stringify([
        {
          bbox: [94, 106, 929, 141],
          list_items: [
            "1.1 What Are R and RStudio? . . 1",
            "1.2 What Does RStudio Look Like? . 1",
          ],
          page_idx: 2,
          sub_type: "text",
          type: "list",
        },
      ]),
    );

    const result = await readMineruLayoutEvidence(join(root, "book.md"));
    expect(result.records).toEqual([
      {
        groupBbox: [94, 106, 929, 141],
        groupId: 0,
        groupItemCount: 2,
        groupItemIndex: 0,
        pageIndex: 2,
        sourceOrder: 0,
        text: "1.1 What Are R and RStudio? . . 1",
        type: "list",
      },
      {
        groupBbox: [94, 106, 929, 141],
        groupId: 0,
        groupItemCount: 2,
        groupItemIndex: 1,
        pageIndex: 2,
        sourceOrder: 1,
        text: "1.2 What Does RStudio Look Like? . 1",
        type: "list",
      },
    ]);
    expect(result.records.every((record) => record.bbox === undefined)).toBe(
      true,
    );
    expect(reconstructPrintedLayoutRows(result).map((row) => row.text)).toEqual(
      [
        "1.1 What Are R and RStudio? . . 1",
        "1.2 What Does RStudio Look Like? . 1",
      ],
    );
  });

  it("supplements one missing list page label from aligned right-column OCR", () => {
    const base: LayoutEvidence = {
      diagnostics: [],
      records: [
        "1.1 Missing page",
        "1.2 Existing 2",
        "1.3 Existing 3",
        "1.4 Existing 6",
        "1.5 Existing 9",
      ].map((text, groupItemIndex) => ({
        groupBbox: [77, 373, 958, 598] as const,
        groupId: 4,
        groupItemCount: 5,
        groupItemIndex,
        pageIndex: 8,
        sourceOrder: groupItemIndex,
        text,
        type: "list",
      })),
      source: "content-list",
    };
    const supplemental: LayoutEvidence = {
      diagnostics: [],
      records: [
        [615, "1"],
        [687, "2"],
        [759, "3"],
        [831, "6"],
        [903, "9"],
      ].map(([top, text], sourceOrder) => ({
        bbox: [985, Number(top), 1006, Number(top) + 17] as const,
        pageIndex: 8,
        sourceOrder,
        text: String(text),
        type: "page-label",
      })),
      source: "ocr",
    };

    const result = supplementMissingListPageLabels(base, supplemental);

    expect(result.records.map((record) => record.text)).toEqual([
      "1.1 Missing page  1",
      "1.2 Existing 2",
      "1.3 Existing 3",
      "1.4 Existing 6",
      "1.5 Existing 9",
    ]);
    expect(result.records[0]).toMatchObject({ pageLabelSupplemented: true });
    expect(result.source).toBe("content-list");
  });

  it("supplements an unnumbered leader row from the same aligned page column", () => {
    const base: LayoutEvidence = {
      diagnostics: [],
      records: [
        "1A 向量 1",
        "复数 . . . . .",
        "组 . . . 4",
        "习题 1A . . . 9",
      ].map((text, groupItemIndex) => ({
        bbox: [
          77,
          100 + groupItemIndex * 50,
          958,
          125 + groupItemIndex * 50,
        ] as const,
        pageIndex: 8,
        sourceOrder: groupItemIndex,
        text,
        type: "list",
      })),
      source: "content-list",
    };
    const supplemental: LayoutEvidence = {
      diagnostics: [],
      records: [
        [125, "1A 向量 . . . 1"],
        [175, "复数 . . . 2"],
        [225, "组 . . . 4"],
        [275, "习题 1A . . . 9"],
      ].map(([top, text], sourceOrder) => ({
        bbox: [77, Number(top), 1006, Number(top) + 17] as const,
        pageIndex: 8,
        sourceOrder,
        text: String(text),
        type: "text",
      })),
      source: "native-pdf",
    };

    const result = supplementMissingListPageLabels(base, supplemental);

    expect(result.records[1]).toMatchObject({
      pageLabelSupplemented: true,
      text: "复数 . . . . .  2",
    });
  });

  it("does not infer a missing page label without two geometric anchors", () => {
    const base: LayoutEvidence = {
      diagnostics: [],
      records: ["1.1 Missing page", "1.2 Existing 2"].map(
        (text, groupItemIndex) => ({
          groupBbox: [77, 373, 958, 598] as const,
          groupId: 4,
          groupItemCount: 2,
          groupItemIndex,
          pageIndex: 8,
          text,
          type: "list",
        }),
      ),
      source: "content-list",
    };
    const supplemental: LayoutEvidence = {
      diagnostics: [],
      records: [
        {
          bbox: [985, 615, 1006, 632],
          pageIndex: 8,
          text: "1",
          type: "page-label",
        },
        {
          bbox: [985, 687, 1006, 704],
          pageIndex: 8,
          text: "2",
          type: "page-label",
        },
      ],
      source: "ocr",
    };

    expect(
      supplementMissingListPageLabels(base, supplemental).records.map(
        (record) => record.text,
      ),
    ).toEqual(["1.1 Missing page", "1.2 Existing 2"]);
  });

  it("returns recoverable diagnostics for missing and malformed evidence", async () => {
    const root = await fixtureRoot();
    await expect(
      readMineruLayoutEvidence(join(root, "book.md")),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "LAYOUT_EVIDENCE_UNAVAILABLE" }],
      records: [],
      source: "none",
    });
    await writeFile(join(root, "book_content_list.json"), "{");
    await expect(
      readMineruLayoutEvidence(join(root, "book.md")),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "LAYOUT_EVIDENCE_INVALID" }],
      records: [],
      source: "none",
    });
  });

  it("drops an overlong body row without discarding later bounded evidence", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "book_content_list.json"),
      JSON.stringify([
        { page_idx: 0, text: "x".repeat(4_001), type: "text" },
        { page_idx: 1, text: "Chapter 1 Start .... 1", type: "text" },
      ]),
    );

    await expect(
      readMineruLayoutEvidence(join(root, "book.md")),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "LAYOUT_EVIDENCE_INVALID" }],
      records: [
        { pageIndex: 0, type: "text" },
        {
          pageIndex: 1,
          text: "Chapter 1 Start .... 1",
          type: "text",
        },
      ],
      source: "content-list",
    });
  });

  it("rejects sidecars above the record limit", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "book_content_list.json"),
      JSON.stringify(Array.from({ length: 20_001 }, () => null)),
    );

    await expect(
      readMineruLayoutEvidence(join(root, "book.md")),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "LAYOUT_EVIDENCE_LIMIT_EXCEEDED" }],
      records: [],
      source: "none",
    });
  });

  it("rejects excessive nesting while streaming", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "book_content_list.json"),
      `${"[".repeat(40)}null${"]".repeat(40)}`,
    );

    await expect(
      readMineruLayoutEvidence(join(root, "book.md")),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "LAYOUT_EVIDENCE_LIMIT_EXCEEDED" }],
      records: [],
      source: "none",
    });
  });

  it("propagates cancellation instead of returning partial evidence", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "book_content_list.json"),
      JSON.stringify([{ page_idx: 0, text: "Contents", type: "text" }]),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      readMineruLayoutEvidence(join(root, "book.md"), controller.signal),
    ).rejects.toThrow("LAYOUT_EVIDENCE_CANCELED");
  });

  it("orders two columns and reconstructs a bounded wrapped row", () => {
    const evidence: LayoutEvidence = {
      diagnostics: [],
      records: [
        {
          bbox: [550, 90, 900, 110],
          pageIndex: 1,
          sourceOrder: 0,
          text: "2 Right chapter .... 8",
          type: "text",
        },
        {
          bbox: [20, 100, 430, 120],
          pageIndex: 1,
          sourceOrder: 1,
          text: "1.1 A long left",
          type: "text",
        },
        {
          bbox: [40, 124, 430, 144],
          pageIndex: 1,
          sourceOrder: 2,
          text: "title continued .... 4",
          type: "text",
        },
      ],
      source: "content-list",
    };

    expect(reconstructPrintedLayoutRows(evidence)).toEqual([
      {
        indent: 20,
        pageIndex: 1,
        text: "1.1 A long left title continued .... 4",
      },
      {
        indent: 550,
        pageIndex: 1,
        text: "2 Right chapter .... 8",
      },
    ]);
  });

  it("joins native PDF fragments on one baseline and across a wrapped row", () => {
    const evidence: LayoutEvidence = {
      diagnostics: [],
      records: [
        {
          bbox: [20, 20, 500, 40],
          pageIndex: 0,
          text: "1.4 A long title",
          type: "text",
        },
        {
          bbox: [620, 21, 650, 41],
          pageIndex: 0,
          text: "24",
          type: "text",
        },
        {
          bbox: [20, 80, 500, 100],
          pageIndex: 0,
          text: "1. 7. 1 Development: 1961~",
          type: "text",
        },
        {
          bbox: [40, 90, 400, 110],
          pageIndex: 0,
          text: "1972 ...... 39",
          type: "text",
        },
      ],
      source: "native-pdf",
    };

    expect(
      reconstructPrintedLayoutRows(evidence).map((row) => row.text),
    ).toEqual([
      "1.4 A long title 24",
      "1. 7. 1 Development: 1961~ 1972 ...... 39",
    ]);
  });

  it("does not append the next entry after a detached right-side page label", () => {
    const evidence: LayoutEvidence = {
      diagnostics: [],
      records: [
        {
          bbox: [36, 216, 150, 228],
          pageIndex: 4,
          sourceOrder: 0,
          text: "第 1 章 向量空间",
          type: "text",
        },
        {
          bbox: [458, 216, 463, 227],
          pageIndex: 4,
          sourceOrder: 1,
          text: "1",
          type: "text",
        },
        {
          bbox: [52, 233, 443, 244],
          pageIndex: 4,
          sourceOrder: 2,
          text: "1A R 和 C . . . . . . . . . . . .",
          type: "text",
        },
        {
          bbox: [458, 233, 463, 244],
          pageIndex: 4,
          sourceOrder: 3,
          text: "2",
          type: "text",
        },
      ],
      source: "native-pdf",
    };

    expect(
      reconstructPrintedLayoutRows(evidence).map((row) => row.text),
    ).toEqual(["第 1 章 向量空间 1", "1A R 和 C . . . . . . . . . . . . 2"]);
  });

  it("joins a base symbol, superscript, leader and page label by x position", () => {
    const evidence: LayoutEvidence = {
      diagnostics: [],
      records: [
        {
          bbox: [76, 283, 82, 292],
          pageIndex: 4,
          sourceOrder: 3,
          text: "F",
          type: "text",
        },
        {
          bbox: [82, 279, 88, 287],
          pageIndex: 4,
          sourceOrder: 0,
          text: "𝑛",
          type: "text",
        },
        {
          bbox: [94, 282, 443, 293],
          pageIndex: 4,
          sourceOrder: 1,
          text: ". . . . . . . . . . . .",
          type: "text",
        },
        {
          bbox: [458, 282, 463, 293],
          pageIndex: 4,
          sourceOrder: 2,
          text: "5",
          type: "text",
        },
      ],
      source: "native-pdf",
    };

    expect(
      reconstructPrintedLayoutRows(evidence).map((row) => row.text),
    ).toEqual(["Fⁿ . . . . . . . . . . . . 5"]);
  });

  it("attaches multiple raised math symbols to their geometric base characters", () => {
    const evidence: LayoutEvidence = {
      diagnostics: [],
      records: [
        {
          bbox: [78, 230, 82, 240],
          pageIndex: 4,
          sourceOrder: 0,
          text: "𝑛",
          type: "text",
        },
        {
          bbox: [52, 231, 105, 243],
          pageIndex: 4,
          sourceOrder: 1,
          text: "1A R 和 C",
          type: "text",
        },
        {
          bbox: [106, 230, 110, 240],
          pageIndex: 4,
          sourceOrder: 2,
          text: "𝑛",
          type: "text",
        },
        {
          bbox: [117, 233, 443, 243],
          pageIndex: 4,
          sourceOrder: 3,
          text: ". . . . . . . . . . . .",
          type: "text",
        },
        {
          bbox: [458, 233, 463, 243],
          pageIndex: 4,
          sourceOrder: 4,
          text: "2",
          type: "text",
        },
      ],
      source: "native-pdf",
    };

    expect(
      reconstructPrintedLayoutRows(evidence).map((row) => row.text),
    ).toEqual(["1A Rⁿ 和 Cⁿ . . . . . . . . . . . . 2"]);
  });

  it("keeps header and footer labels separate from nearby contents rows", () => {
    const evidence: LayoutEvidence = {
      diagnostics: [],
      records: [
        {
          bbox: [458, 15, 463, 26],
          pageIndex: 6,
          sourceOrder: 0,
          text: "v",
          type: "text",
        },
        {
          bbox: [52, 37, 443, 49],
          pageIndex: 6,
          sourceOrder: 1,
          text: "5B Minimum polynomial . . . . . . . .",
          type: "text",
        },
        {
          bbox: [448, 37, 463, 49],
          pageIndex: 6,
          sourceOrder: 2,
          text: "120",
          type: "text",
        },
        {
          bbox: [458, 760, 463, 771],
          pageIndex: 6,
          sourceOrder: 3,
          text: "7",
          type: "text",
        },
      ],
      source: "native-pdf",
    };

    expect(
      reconstructPrintedLayoutRows(evidence).map((row) => row.text),
    ).toEqual(["v", "5B Minimum polynomial . . . . . . . . 120", "7"]);
  });

  it("restores a detached technical token inside a numbered PDF row", () => {
    const evidence: LayoutEvidence = {
      diagnostics: [],
      records: [
        {
          bbox: [80, 15, 330, 40],
          pageIndex: 0,
          sourceOrder: 0,
          text: "between routes: BGP .... 262",
          type: "text",
        },
        {
          bbox: [20, 24, 45, 34],
          pageIndex: 0,
          sourceOrder: 1,
          text: "5. 4",
          type: "text",
        },
        {
          bbox: [52, 24, 70, 34],
          pageIndex: 0,
          sourceOrder: 2,
          text: "ISP",
          type: "text",
        },
      ],
      source: "native-pdf",
    };

    expect(
      reconstructPrintedLayoutRows(evidence).map((row) => row.text),
    ).toEqual(["5. 4 ISP between routes: BGP .... 262"]);
  });

  it("joins a detached section number to a technical-number title", () => {
    const evidence: LayoutEvidence = {
      diagnostics: [],
      records: [
        {
          bbox: [20, 20, 80, 40],
          pageIndex: 0,
          text: "7. 3. 1",
          type: "text",
        },
        {
          bbox: [40, 42, 520, 62],
          pageIndex: 0,
          text: "802. 11 wireless architecture ...... 357",
          type: "text",
        },
      ],
      source: "native-pdf",
    };

    expect(
      reconstructPrintedLayoutRows(evidence).map((row) => row.text),
    ).toEqual(["7. 3. 1 802. 11 wireless architecture ...... 357"]);
  });

  it("normalizes indentation independently inside each column", () => {
    const evidence: LayoutEvidence = {
      diagnostics: [],
      records: [
        {
          bbox: [20, 20, 200, 40],
          pageIndex: 0,
          text: "1 Left .... 1",
          type: "text",
        },
        {
          bbox: [40, 50, 200, 70],
          pageIndex: 0,
          text: "1.1 Left child .... 2",
          type: "text",
        },
        {
          bbox: [550, 20, 800, 40],
          pageIndex: 0,
          text: "2 Right .... 3",
          type: "text",
        },
        {
          bbox: [570, 50, 800, 70],
          pageIndex: 0,
          text: "2.1 Right child .... 4",
          type: "text",
        },
      ],
      source: "native-pdf",
    };

    expect(
      reconstructPrintedLayoutRows(evidence).map((row) => row.indent),
    ).toEqual([0, 20, 0, 20]);
  });

  it("does not let a centered part title collapse two contents columns", () => {
    const evidence: LayoutEvidence = {
      diagnostics: [],
      records: [
        {
          bbox: [96, 20, 180, 30],
          pageIndex: 0,
          text: "9.1 Left .... 1",
          type: "text",
        },
        {
          bbox: [210, 32, 405, 42],
          pageIndex: 0,
          text: "MEMORY MANAGEMENT",
          type: "text",
        },
        {
          bbox: [96, 50, 220, 60],
          pageIndex: 0,
          text: "9.2 Left child .... 2",
          type: "text",
        },
        {
          bbox: [280, 20, 410, 30],
          pageIndex: 0,
          text: "9.3 Right .... 3",
          type: "text",
        },
        {
          bbox: [280, 50, 420, 60],
          pageIndex: 0,
          text: "9.4 Right child .... 4",
          type: "text",
        },
      ],
      source: "native-pdf",
    };

    expect(
      reconstructPrintedLayoutRows(evidence).map((row) => row.text),
    ).toEqual([
      "9.1 Left .... 1",
      "9.2 Left child .... 2",
      "9.3 Right .... 3",
      "MEMORY MANAGEMENT",
      "9.4 Right child .... 4",
    ]);
  });

  it("orders three columns without interleaving their vertical positions", () => {
    const records = [
      [680, 30, "C1"],
      [20, 40, "A1"],
      [350, 20, "B1"],
      [680, 70, "C2"],
      [20, 80, "A2"],
      [350, 60, "B2"],
    ].map(([left, top, text], sourceOrder) => ({
      bbox: [
        Number(left),
        Number(top),
        Number(left) + 260,
        Number(top) + 20,
      ] as const,
      pageIndex: 4,
      sourceOrder,
      text: String(text),
      type: "text",
    }));
    const evidence: LayoutEvidence = {
      diagnostics: [],
      records,
      source: "content-list",
    };

    expect(
      reconstructPrintedLayoutRows(evidence).map((row) => row.text),
    ).toEqual(["A1", "A2", "B1", "B2", "C1", "C2"]);
  });

  it("uses a streaming parser rather than whole-file readFile JSON parsing", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL(
          "../../../src/compiler/document/layout-evidence.ts",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(source).not.toMatch(/readFile|JSON\.parse/u);
  });
});
