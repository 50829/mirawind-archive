import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import {
  SourceRegionValidationError,
  applySourceRegions,
  utf8ByteOffset,
} from "@/compiler/document/source-regions";
import type { ConfirmedSourceRegion } from "@/compiler/document/types";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function setup() {
  const source =
    "# 目录\n\n# 第一章 中文 ...... 1\n\n# 第一章 中文\n\n正文与脚注[^a]。\n\n[^a]: 说明\n";
  let ordinal = 0;
  const document = normalizeDocumentBlocks(parseMarkdownDocument(source), {
    idFactory: () => `blk_${String(++ordinal).padStart(16, "0")}`,
  });
  const children = document.root.children ?? [];
  const start = children[0]?.position?.start.offset ?? 0;
  const end = children[1]?.position?.end.offset ?? 0;
  const startByte = utf8ByteOffset(source, start);
  const endByte = utf8ByteOffset(source, end);
  const region: ConfirmedSourceRegion = {
    disposition: "reference_only",
    entries: [],
    kind: "printed_toc",
    range: {
      end_byte: endByte,
      sha256: sha(Buffer.from(source).subarray(startByte, endByte).toString()),
      start_byte: startByte,
    },
    region_id: "region_abcdefghijklmnop",
    source_path: "source/full.md",
    source_sha256: sha(source),
  };
  return { document, region, source };
}

describe("reference-only source regions", () => {
  it("converts Unicode offsets to UTF-8 bytes and reversibly filters complete root blocks", () => {
    const { document, region, source } = setup();
    expect(utf8ByteOffset(source, source.indexOf("中"))).toBe(
      Buffer.byteLength(source.slice(0, source.indexOf("中")), "utf8"),
    );
    const result = applySourceRegions({
      document,
      mainMarkdownPath: "source/full.md",
      mainMarkdownSha256: sha(source),
      regions: [region],
    });
    expect(result.document.headings.map((heading) => heading.sourceTitle)).toEqual([
      "第一章 中文",
    ]);
    expect(result.excludedBlockIds.size).toBeGreaterThan(0);
    expect(document.headings).toHaveLength(3);

    const restored = applySourceRegions({
      document,
      mainMarkdownPath: "source/full.md",
      mainMarkdownSha256: sha(source),
      regions: [],
    });
    expect(restored.document.root.children).toEqual(document.root.children);
  });

  it.each([
    ["digest", (region: ConfirmedSourceRegion) => ({
      ...region,
      range: { ...region.range, sha256: "f".repeat(64) },
    })],
    ["partial", (region: ConfirmedSourceRegion) => ({
      ...region,
      range: { ...region.range, start_byte: region.range.start_byte + 1 },
    })],
    ["reversed", (region: ConfirmedSourceRegion) => ({
      ...region,
      range: {
        ...region.range,
        end_byte: region.range.start_byte,
      },
    })],
  ])("rejects %s ranges", (_label, mutate) => {
    const { document, region, source } = setup();
    expect(() =>
      applySourceRegions({
        document,
        mainMarkdownPath: "source/full.md",
        mainMarkdownSha256: sha(source),
        regions: [mutate(region)],
      }),
    ).toThrow(SourceRegionValidationError);
  });

  it("rejects overlapping regions", () => {
    const { document, region, source } = setup();
    expect(() =>
      applySourceRegions({
        document,
        mainMarkdownPath: "source/full.md",
        mainMarkdownSha256: sha(source),
        regions: [
          region,
          { ...region, region_id: "region_qrstuvwxyzabcdef" },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "SOURCE_REGION_INVALID" }));
  });

  it("rejects removing a definition referenced by active content", () => {
    const { document, source } = setup();
    const definition = document.root.children?.at(-1);
    const start = definition?.position?.start.offset ?? 0;
    const end = definition?.position?.end.offset ?? 0;
    const startByte = utf8ByteOffset(source, start);
    const endByte = utf8ByteOffset(source, end);
    expect(() =>
      applySourceRegions({
        document,
        mainMarkdownPath: "source/full.md",
        mainMarkdownSha256: sha(source),
        regions: [
          {
            disposition: "reference_only",
            entries: [],
            kind: "printed_toc",
            range: {
              end_byte: endByte,
              sha256: sha(
                Buffer.from(source)
                  .subarray(startByte, endByte)
                  .toString(),
              ),
              start_byte: startByte,
            },
            region_id: "region_abcdefghijklmnop",
            source_path: "source/full.md",
            source_sha256: sha(source),
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining({ code: "SOURCE_REGION_REFERENCE_CONFLICT" }),
    );
  });
});
