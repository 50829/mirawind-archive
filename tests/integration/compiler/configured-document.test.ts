import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { prepareConfiguredDocument } from "@/compiler/document/configured-document";
import {
  buildDocumentManifest,
  canonicalJson,
} from "@/compiler/document/manifest";
import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import { detectPrintedContents } from "@/compiler/document/printed-toc";
import { proposeDocumentStructure } from "@/compiler/document/structure-proposal";
import { buildSearchSpool } from "@/compiler/search/build-spool";
import { validateBookConfig } from "@/schemas/book-config";

const fixturePath = fileURLToPath(
  new URL("../../fixtures/publishing-quality/printed-toc.md", import.meta.url),
);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("configured document preparation", () => {
  it("preserves source while excluding printed contents from every derived consumer", async () => {
    const markdown = await readFile(fixturePath, "utf8");
    const sourceSha256 = sha256(markdown);
    let ordinal = 0;
    const proposedDocument = normalizeDocumentBlocks(
      parseMarkdownDocument(markdown),
      {
        idFactory: () => `blk_${String(++ordinal).padStart(20, "0")}`,
      },
    );
    const detection = detectPrintedContents({
      document: proposedDocument,
      idFactory: () => "region_abcdefghijklmnop",
      sourcePath: "book.md",
      sourceSha256,
    });
    const regions = detection.candidates.flatMap((candidate) =>
      candidate.proposedRegion ? [candidate.proposedRegion] : [],
    );
    const config = validateBookConfig({
      book_id: 1,
      publishing: {
        code: { line_numbers: false },
        numbering: { mode: "normalized" },
      },
      revision: 2,
      schema_version: 3,
      source: {
        main_markdown: "book.md",
        main_markdown_sha256: sourceSha256,
        original_files: [],
        preprocessing: {
          typography: {
            input_sha256: sourceSha256,
            output_sha256: sourceSha256,
            profile: "verbatim-v1",
            protected_nodes: 0,
            punctuation_converted: 0,
            spaces_normalized: 0,
          },
        },
      },
      source_regions: regions,
      structure: proposeDocumentStructure(proposedDocument, {
        sourceRegions: regions,
      }).nodes,
      title: "机器学习",
    });
    const configSha256 = sha256(stringify(config, { lineWidth: 0 }));

    const configured = prepareConfiguredDocument({
      config,
      configSha256,
      markdownBytes: markdown,
    });
    const repeated = prepareConfiguredDocument({
      config,
      configSha256,
      markdownBytes: markdown,
    });

    expect(configured.fullDocument.source).toBe(markdown);
    expect(configured.fullDocument.headings).toHaveLength(9);
    expect(
      configured.document.headings.map((heading) => heading.sourceTitle),
    ).toEqual([
      "第 1 章 绪论",
      "1.1 中文与 English 排版",
      "1.2 模型评估",
      "第 2 章 方法",
      "2.1 训练",
      "2.2 测试",
    ]);
    expect(configured.headings.map((heading) => heading.display_level)).toEqual(
      [1, 2, 2, 1, 2, 2],
    );
    expect(configured.headings.map((heading) => heading.number)).toEqual([
      "1",
      "1.1",
      "1.2",
      "2",
      "2.1",
      "2.2",
    ]);
    expect(configured.pages).toHaveLength(2);
    expect(configured.identity).toEqual(repeated.identity);
    expect(configured.identity).toMatchObject({
      compiler_version: "compiler-v4",
      config_sha256: configSha256,
      renderer_version: "semantic-html-v4-katex-0.18.1",
      semantic_digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      source_sha256: sourceSha256,
    });

    const manifest = buildDocumentManifest({
      bookId: 1,
      configRevision: 2,
      createdAt: "2026-07-25T00:00:00.000Z",
      document: configured.document,
      headings: configured.headings,
      mainMarkdownOutputPath: "source/book.md",
      pages: configured.pages,
      resourceReferences: [],
      resources: [],
      sourceFiles: [
        {
          path: "source/book.md",
          sha256: sourceSha256,
          size: Buffer.byteLength(markdown),
        },
      ],
      versionId: "ver_abcdefghijklmnop",
    });
    const search = buildSearchSpool({
      authors: [],
      bookId: 1,
      document: configured.document,
      headings: configured.headings,
      pages: configured.pages,
      title: "机器学习",
      versionId: "ver_abcdefghijklmnop",
    });
    const derivedText = `${canonicalJson(manifest)}${canonicalJson(search)}`;

    expect(derivedText).not.toContain('"目录"');
    expect(derivedText).not.toContain("...... 1");
    expect(derivedText).toContain("中文与 English 排版");
  });
});
