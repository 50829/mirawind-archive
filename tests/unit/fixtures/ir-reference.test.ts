import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptReviewedReference } from "../../../scripts/fixtures/author-mineru-references";
import { compareMineruReference } from "../../../scripts/fixtures/compare-mineru-references";
import {
  observeContentRecords,
  type MineruReferencePack,
} from "../../../scripts/fixtures/create-mineru-reference-pack";
import { parseMineruReference } from "../../../scripts/fixtures/mineru-reference";
import { observeRealMineruFixture } from "../../../scripts/fixtures/observe-mineru-references";
import { mineruZip, mineruTitle, mineruText } from "../../helpers/mineru-v2";
import { createTemporaryDataRoot } from "../../helpers/data-root";
import { smallBook, headingBlock, paragraphBlock } from "../../helpers/ir-book";
import { verifySourceContent } from "../../../scripts/fixtures/source-content-fidelity";

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function fixture() {
  const pages = [
    [
      mineruTitle("Book"),
      {
        type: "code",
        content: {
          code_content: [mineruText("print(1)")],
          code_language: "python",
          code_caption: [],
        },
      },
    ],
  ];
  const pdf = "%PDF synthetic";
  const archive = mineruZip(pages, [
    { name: "result/book_origin.pdf", data: pdf },
  ]);
  const pack: MineruReferencePack = {
    schema_version: 2,
    fixture_id: "real-mineru-a7f31c",
    archive_sha256: hash(archive),
    content_json: {
      relative_path: "result/content_list_v2.json",
      input_sha256: hash(JSON.stringify(pages)),
      records: observeContentRecords(pages),
    },
    pdf_documents: [
      {
        page_count: 1,
        relative_path: "result/book_origin.pdf",
        sha256: hash(pdf),
        rendered_pages: [],
      },
    ],
    sidecars: [],
  };
  const reference = parseMineruReference({
    schema_version: 3,
    fixture_id: pack.fixture_id,
    archive_sha256: pack.archive_sha256,
    evidence_sha256: hash("independent review"),
    content_json: {
      relative_path: pack.content_json.relative_path,
      input_sha256: pack.content_json.input_sha256,
    },
    original_pdf: {
      page_count: 1,
      relative_path: "result/book_origin.pdf",
      sha256: hash(pdf),
    },
    printed_contents: { state: "absent", regions: [] },
  });
  return { archive, pack, reference, pages };
}
describe("IR independent content evidence", () => {
  it("keeps typed formulas out of text-markup parsing during source comparison", () => {
    const source = [
      [
        {
          type: "paragraph",
          content: {
            paragraph_content: [
              { type: "equation_inline", content: "x<t" },
              mineruText(" and x<sub>i</sub>"),
            ],
          },
        },
      ],
    ];
    const book = smallBook(),
      paragraph = paragraphBlock("");
    paragraph.content = [
      { type: "math", latex: "x<t" },
      { type: "text", text: " and x" },
      { type: "subscript", content: [{ type: "text", text: "i" }] },
    ];
    book.blocks = [paragraph];
    book.publishing.boundaries.body_start_block_id = paragraph.id;
    expect(
      verifySourceContent({
        source,
        book,
        excludedBlockIds: new Set(),
        origins: [
          {
            block_id: paragraph.id,
            page_index: 0,
            source_index: 0,
            source_type: "paragraph",
          },
        ],
      }).issues,
    ).toEqual([]);
  });
  it("rejects unknown fields and inconsistent reviewed input bindings", () => {
    const { pack, reference } = fixture();
    expect(acceptReviewedReference(pack, reference)).toEqual(reference);
    expect(() =>
      parseMineruReference({ ...reference, invented: true }),
    ).toThrow();
    expect(() =>
      acceptReviewedReference(pack, {
        ...reference,
        archive_sha256: "f".repeat(64),
      }),
    ).toThrow("REFERENCE_REVIEW_BINDING_MISMATCH");
  });
  it("observes production IR without reference input and detects changed content and missing headings", async () => {
    const root = await createTemporaryDataRoot("ir-reference");
    try {
      const { archive, pack, reference, pages } = fixture();
      const archivePath = join(root.path, "book.zip");
      await writeFile(archivePath, archive);
      const actual = await observeRealMineruFixture({
        archivePath,
        pack,
        stagingDirectory: join(root.path, "stage"),
      });
      expect(compareMineruReference(reference, actual).issues).toEqual([]);
      const book = smallBook();
      const heading = headingBlock("Book");
      const code = {
        id: "blk_corrupted_code_0000001",
        type: "code" as const,
        language: "python",
        code: "print(2)",
      };
      book.blocks = [code];
      const sourceFidelity = verifySourceContent({
        source: pages,
        book,
        excludedBlockIds: new Set(),
        origins: [
          {
            block_id: heading.id,
            page_index: 0,
            source_index: 0,
            source_type: "title",
          },
          {
            block_id: code.id,
            page_index: 0,
            source_index: 1,
            source_type: "code",
          },
        ],
      });
      const changed = { ...actual, source_fidelity: sourceFidelity };
      expect(compareMineruReference(reference, changed).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "SOURCE_CODE_CHANGED" }),
          expect.objectContaining({ code: "SOURCE_BLOCK_MISSING" }),
        ]),
      );
      await expect(
        observeRealMineruFixture({
          archivePath,
          pack: { ...pack, archive_sha256: "f".repeat(64) },
          stagingDirectory: join(root.path, "other"),
        }),
      ).rejects.toThrow("OBSERVED_REFERENCE_PACK_BINDING_MISMATCH");
    } finally {
      await root.cleanup();
    }
  });
});
