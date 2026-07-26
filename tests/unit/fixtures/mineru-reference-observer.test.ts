import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MineruReferencePack } from "../../../scripts/fixtures/create-mineru-reference-pack";
import { observeRealMineruFixture } from "../../../scripts/fixtures/observe-mineru-references";
import { buildZip } from "../../../scripts/fixtures/zip-builder";
import { parseMarkdownDocument } from "@/compiler/document/parser";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function visible(node: {
  readonly children?: readonly unknown[];
  readonly value?: unknown;
}): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? [])
    .map((child) => visible(child as Parameters<typeof visible>[0]))
    .join("");
}

function packFor(source: string, archiveSha256: string): MineruReferencePack {
  const document = parseMarkdownDocument(source);
  const documentRoots = document.root.children ?? [];
  const observations = documentRoots.map((node, rootIndex) => {
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? 0;
    return Object.freeze({
      end_offset: end,
      root_index: rootIndex,
      sha256: hash(source.slice(start, end)),
      start_offset: start,
      type: node.type,
    });
  });
  return Object.freeze({
    archive_sha256: archiveSha256,
    fixture_id: "real-mineru-a7f31c",
    markdown_documents: Object.freeze([
      Object.freeze({
        headings: Object.freeze(
          documentRoots.flatMap((node, rootIndex) => {
            const observation = observations[rootIndex];
            return node.type === "heading" && observation
              ? [
                  Object.freeze({
                    ...observation,
                    depth: node.depth ?? 1,
                    text: visible(node),
                  }),
                ]
              : [];
          }),
        ),
        input_sha256: hash(source),
        relative_path: "bundle/full.md",
        root_blocks: Object.freeze(observations),
      }),
    ]),
    pdf_documents: Object.freeze([
      Object.freeze({
        page_count: 12,
        relative_path: "bundle/book_origin.pdf",
        rendered_pages: Object.freeze([]),
        sha256: hash("pdf"),
      }),
    ]),
    schema_version: 1,
    sidecars: Object.freeze([]),
  });
}

describe("real MinerU production observer", () => {
  it("projects detector output without reading expected reference decisions", async () => {
    const source = [
      "# Book",
      "",
      "## Contents",
      "",
      "## Chapter 1 Start .... 1",
      "",
      "## 1.1 Basics .... 2",
      "",
      "## Chapter 1 Start",
      "",
      "Body.",
      "",
      "## 1.1 Basics",
      "",
      "Body with `/资料/a,b.md` and $x=/公式/a.md$.",
    ].join("\n");
    const root = await mkdtemp(join(tmpdir(), "reference-observer-test-"));
    roots.push(root);
    const archivePath = join(root, "book.zip");
    const archive = buildZip({
      entries: [
        { data: source, name: "bundle/full.md" },
        { data: "%PDF synthetic", name: "bundle/book_origin.pdf" },
        {
          data: JSON.stringify([
            {
              bbox: [100, 100, 800, 140],
              page_idx: 2,
              text: "Chapter 1 Start .... 1",
              text_level: 2,
              type: "text",
            },
            {
              bbox: [130, 150, 800, 190],
              page_idx: 3,
              text: "1.1 Basics .... 2",
              type: "text",
            },
          ]),
          name: "bundle/full_content_list.json",
        },
      ],
    });
    await writeFile(archivePath, archive);
    const observed = await observeRealMineruFixture({
      archivePath,
      pack: packFor(source, hash(archive)),
      stagingDirectory: join(root, "staging"),
    });

    expect(observed.printed_contents).toMatchObject({
      regions: [
        {
          canonical: true,
          entries: [
            { expected_match: "matched", level: 1, page_label: "1" },
            { expected_match: "matched", level: 2, page_label: "2" },
          ],
          pdf_page_indices: [2, 3],
          region_key: "full-contents",
        },
      ],
      state: "present",
    });
    expect(
      observed.raw_heading_accounting.filter(
        (heading) => heading.disposition.kind === "excluded",
      ),
    ).toHaveLength(3);
    expect(observed.protected_ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "code" }),
        expect.objectContaining({ kind: "formula" }),
      ]),
    );
    expect(
      observed.protected_ranges.every(
        (range) => range.sha256 === range.output_sha256,
      ),
    ).toBe(true);
  });
});
