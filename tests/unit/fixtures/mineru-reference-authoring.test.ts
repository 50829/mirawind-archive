import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  authorMineruReferenceV2,
  createVisionTranscriptTemplate,
  type CodexVisionTranscript,
  type VisionTranscriptTemplate,
} from "../../../scripts/fixtures/author-mineru-references";
import type { MineruReferencePack } from "../../../scripts/fixtures/create-mineru-reference-pack";
import { parseMarkdownDocument } from "@/compiler/document/parser";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function text(node: {
  readonly children?: readonly unknown[];
  readonly value?: unknown;
}): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? [])
    .map((child) => text(child as Parameters<typeof text>[0]))
    .join("");
}

function packFor(source: string): MineruReferencePack {
  const document = parseMarkdownDocument(source);
  const roots = document.root.children ?? [];
  const observations = roots.map((node, rootIndex) => {
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
    archive_sha256: hash("archive"),
    fixture_id: "real-mineru-a7f31c",
    markdown_documents: Object.freeze([
      Object.freeze({
        headings: Object.freeze(
          roots.flatMap((node, rootIndex) => {
            if (node.type !== "heading") return [];
            const observed = observations[rootIndex];
            if (!observed) return [];
            return [
              Object.freeze({
                ...observed,
                depth: node.depth ?? 1,
                text: text(node),
              }),
            ];
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
        rendered_pages: Object.freeze([
          Object.freeze({
            page_index: 2,
            relative_path: "pages/pdf-001/page-0003.png",
            sha256: hash("page three"),
          }),
        ]),
        sha256: hash("original pdf"),
      }),
    ]),
    schema_version: 1,
    sidecars: Object.freeze([]),
  });
}

describe("Codex vision reference authoring", () => {
  function reviewed(template: VisionTranscriptTemplate): CodexVisionTranscript {
    return Object.freeze({
      ...template,
      source: "codex-image-recognition" as const,
    });
  }

  it("binds image-inspected structure without production proposals", () => {
    const source = [
      "# Book",
      "",
      "## Contents",
      "",
      "## Part I Foundations",
      "",
      "## Chapter 1 Start .... 1",
      "",
      "## 1.1 Basics .... 2",
      "",
      "## Part I Foundations",
      "",
      "## Chapter 1 Start",
      "",
      "Body.",
      "",
      "## 1.1 Basics",
      "",
      "Body.",
    ].join("\n");
    const pack = packFor(source);
    const document = parseMarkdownDocument(source);
    const template = createVisionTranscriptTemplate({
      decision: {
        fixture_id: pack.fixture_id,
        printed_contents: {
          regions: [
            {
              canonical: true,
              end_root: 4,
              pdf_page_indices: [2],
              region_key: "full-contents",
              start_root: 1,
            },
          ],
          state: "present",
        },
      },
      document,
      pack,
    });

    expect(template).toMatchObject({
      inspected_pages: [{ page_index: 2 }],
      source: "unverified-markdown-template",
    });
    const transcript = reviewed(template);
    expect(transcript.regions[0]?.entries).toMatchObject([
      { kind: "part", level: 1, title: "Part I Foundations" },
      { kind: "chapter", level: 2, page_label: "1" },
      { kind: "section", level: 3, page_label: "2" },
    ]);
    expect(JSON.stringify(transcript)).not.toMatch(
      /boundaryConfidence|bodyHeadingBlockId|proposedRegion/u,
    );

    const reference = authorMineruReferenceV2({ pack, transcript });
    expect(reference.printed_contents.regions[0]?.entries).toMatchObject([
      { expected_match: "matched", level: 1 },
      { expected_match: "matched", level: 2 },
      { expected_match: "matched", level: 3 },
    ]);
    expect(reference.raw_heading_accounting).toHaveLength(8);
    expect(
      reference.raw_heading_accounting
        .slice(1, 5)
        .every((heading) => heading.disposition.kind === "excluded"),
    ).toBe(true);
  });

  it("records an inspected frontmatter set for a no-contents book", () => {
    const source = "# Book\n\n## Preface\n\nBody.\n";
    const pack = packFor(source);
    const transcript = reviewed(
      createVisionTranscriptTemplate({
        decision: {
          fixture_id: pack.fixture_id,
          printed_contents: { state: "absent" },
        },
        document: parseMarkdownDocument(source),
        pack,
      }),
    );
    const reference = authorMineruReferenceV2({ pack, transcript });

    expect(transcript.inspected_pages).toEqual([
      { page_index: 2, sha256: hash("page three") },
    ]);
    expect(reference.printed_contents).toEqual({
      regions: [],
      state: "absent",
    });
  });

  it("caps expected diagnostics to the private analysis contract", () => {
    const entries = Array.from(
      { length: 101 },
      (_, index) => `## Chapter ${index + 1} Missing ${index + 1}`,
    );
    const source = ["# Book", "", "## Contents", "", ...entries].join("\n\n");
    const pack = packFor(source);
    const transcript = reviewed(
      createVisionTranscriptTemplate({
        decision: {
          fixture_id: pack.fixture_id,
          printed_contents: {
            regions: [
              {
                canonical: true,
                end_root: 102,
                pdf_page_indices: [2],
                region_key: "full-contents",
                start_root: 1,
              },
            ],
            state: "present",
          },
        },
        document: parseMarkdownDocument(source),
        pack,
      }),
    );

    expect(
      authorMineruReferenceV2({ pack, transcript }).expected_diagnostics,
    ).toHaveLength(100);
  });

  it("rejects an unreviewed Markdown-derived transcript", () => {
    const source = "# Book\n\n## Contents\n\nChapter 1 Start 1\n";
    const pack = packFor(source);
    const template = createVisionTranscriptTemplate({
      decision: {
        fixture_id: pack.fixture_id,
        printed_contents: {
          regions: [
            {
              canonical: true,
              end_root: 2,
              pdf_page_indices: [2],
              region_key: "full-contents",
              start_root: 1,
            },
          ],
          state: "present",
        },
      },
      document: parseMarkdownDocument(source),
      pack,
    });

    expect(() =>
      authorMineruReferenceV2({
        pack,
        transcript: template as unknown as CodexVisionTranscript,
      }),
    ).toThrow("VISION_TRANSCRIPT_INVALID");
  });
});
