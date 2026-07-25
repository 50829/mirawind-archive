import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import { detectPrintedContents } from "@/compiler/document/printed-toc";

const fixturePath = fileURLToPath(
  new URL("../../fixtures/publishing-quality/printed-toc.md", import.meta.url),
);
const ambiguousPath = fileURLToPath(
  new URL(
    "../../fixtures/publishing-quality/ambiguous-toc.md",
    import.meta.url,
  ),
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

  it("leaves repeated ambiguous labels unapplied", async () => {
    const source = await readFile(ambiguousPath, "utf8");
    const result = detectPrintedContents({
      document: documentFor(source),
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "source/full.md",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });
    expect(result.candidates[0]).toMatchObject({
      confidence: expect.not.stringMatching(/^high$/u),
    });
    expect(result.candidates[0]?.proposedRegion).toBeUndefined();
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
});
