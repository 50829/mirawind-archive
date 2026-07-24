import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import {
  DocumentParseError,
  parseMarkdownDocument,
} from "@/compiler/document/parser";
import type { TransientDocumentNode } from "@/compiler/document/types";
import { renderDraftPreview } from "@/compiler/render/preview";
import { resolveDocumentResources } from "@/compiler/resources/resolver";
import { isOpaqueId } from "@/domain/ids";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

function nodes(
  root: TransientDocumentNode,
  type: string,
): readonly TransientDocumentNode[] {
  const matches: TransientDocumentNode[] = [];
  const visit = (node: TransientDocumentNode) => {
    if (node.type === type) matches.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return matches;
}

async function fixture(
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "document-parse-"));
  temporaryRoots.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = resolve(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  return root;
}

describe("transient Markdown document parsing", () => {
  it("fatally rejects invalid UTF-8", () => {
    let thrown: unknown;
    try {
      parseMarkdownDocument(Uint8Array.from([0x23, 0x20, 0xc3, 0x28]));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DocumentParseError);
    expect(thrown).toMatchObject({ code: "MARKDOWN_INVALID_UTF8" });
  });

  it("preserves current source positions with Unicode, GFM and math", () => {
    const source = [
      "😀",
      "# Heading",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "Inline $x+1$.",
      "",
      "$$",
      "y=2",
      "$$",
    ].join("\n");
    const document = parseMarkdownDocument(source);
    const heading = nodes(document.root, "heading")[0];

    expect(
      source.slice(
        heading?.position?.start.offset,
        heading?.position?.end.offset,
      ),
    ).toBe("# Heading");
    expect(heading?.position?.start).toMatchObject({ column: 1, line: 2 });
    expect(nodes(document.root, "table")).toHaveLength(1);
    expect(nodes(document.root, "inlineMath")).toHaveLength(1);
    expect(nodes(document.root, "math")).toHaveLength(1);
  });

  it("parses all eight nested semantic containers without changing offsets", () => {
    const kinds = [
      "definition",
      "theorem",
      "proof",
      "example",
      "exercise",
      "solution",
      "note",
      "warning",
    ];
    const source = kinds
      .map((kind) => `::: ${kind}\nText for ${kind}.\n:::`)
      .join("\n\n");
    const document = parseMarkdownDocument(source);
    const containers = nodes(document.root, "semanticContainer");

    expect(containers.map((node) => node.containerKind)).toEqual(kinds);
    for (const container of containers) {
      expect(
        source.slice(
          container.position?.start.offset,
          container.position?.end.offset,
        ),
      ).toMatch(/^::: [a-z]+/u);
    }
  });

  it("assigns ordered opaque block IDs, extracts headings and fingerprints NFC text", () => {
    const source =
      "# Cafe\u0301\r\n\r\nFirst paragraph.\r\n\r\nSecond paragraph.";
    const parsed = parseMarkdownDocument(source);
    const normalized = normalizeDocumentBlocks(parsed);

    expect(normalized.source).toBe(source);
    expect(normalized.blocks).toHaveLength(3);
    expect(
      normalized.blocks.every((block) =>
        isOpaqueId("block", block.blockId ?? ""),
      ),
    ).toBe(true);
    expect(new Set(normalized.blocks.map((block) => block.blockId)).size).toBe(
      3,
    );
    expect(
      normalized.blocks.map((block) => block.position?.start.offset),
    ).toEqual([0, 11, 31]);
    expect(normalized.headings).toEqual([
      expect.objectContaining({
        level: 1,
        sourceTitle: "Café",
        textFingerprint: expect.stringMatching(/^tfp_v1_[A-Za-z0-9_-]{43}$/u),
      }),
    ]);
  });
});

describe("contained document resources and sanitized preview", () => {
  it("maps contained resources once and reports missing, remote and cross-root references", async () => {
    const root = await fixture({
      "book/chapter.md": [
        "![ok](images/ok.png?size=2#view)",
        "![same](images/ok.png)",
        "![missing](images/missing.png)",
        "![remote](https://example.test/tracker.png)",
        "![outside](%2e%2e/secret.png)",
      ].join("\n"),
      "book/images/ok.png": Uint8Array.from([1, 2, 3]),
      "secret.png": Uint8Array.from([4, 5, 6]),
    });
    const markdownPath = resolve(root, "book/chapter.md");
    const resolution = await resolveDocumentResources({
      document: parseMarkdownDocument(
        await import("node:fs/promises").then((fs) =>
          fs.readFile(markdownPath),
        ),
      ),
      idFactory: () => "res_test_contained",
      markdownPath,
      resourceRoot: resolve(root, "book"),
    });

    expect(resolution.resources).toEqual([
      expect.objectContaining({
        id: "res_test_contained",
        relativePath: "images/ok.png",
      }),
    ]);
    expect(resolution.references).toHaveLength(2);
    expect(resolution.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      ["RESOURCE_MISSING", "RESOURCE_URL_REJECTED", "RESOURCE_OUTSIDE_ROOT"],
    );
    expect(JSON.stringify(resolution.diagnostics)).not.toContain("secret.png");
  });

  it("keeps only resolver-mapped images and removes executable raw HTML and unsafe URLs", async () => {
    const source = [
      "# Safe",
      "",
      "![kept](images/ok.png)",
      "",
      '<img src="https://tracker.test/a.png" onerror="alert(1)">',
      '<p onclick="alert(2)">Retained text</p>',
      '<script>alert("bad")</script>',
      "",
      "[bad](javascript:evil)",
      "",
      "Inline $x+1$.",
    ].join("\n");
    const root = await fixture({
      "book/chapter.md": source,
      "book/images/ok.png": Uint8Array.from([1, 2, 3]),
    });
    const markdownPath = resolve(root, "book/chapter.md");
    const document = parseMarkdownDocument(source);
    const resolution = await resolveDocumentResources({
      document,
      markdownPath,
      resourceRoot: resolve(root, "book"),
    });
    const html = await renderDraftPreview({
      authenticatedResourceUrl: (resourceId) =>
        `/api/manage/books/book_test/preview/7/assets/${resourceId}`,
      document,
      resourceResolution: resolution,
    });

    expect(html).toContain("Retained text");
    expect(html).toContain("/api/manage/books/book_test/preview/7/assets/res_");
    expect(html).toContain('class="katex"');
    expect(html).not.toMatch(
      /script|onclick|onerror|javascript:|tracker\.test/iu,
    );
    expect(html.match(/<img /gu) ?? []).toHaveLength(1);
    expect(document.source).toBe(source);
  });
});
