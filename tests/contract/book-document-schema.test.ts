import { required } from "../helpers/required";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateBookDocument } from "@/modules/publishing/core/content/book-document";
import { smallBook, headingBlock } from "../helpers/ir-book";
describe("strict book.json v1 contract", () => {
  it("accepts the documented native IR example", async () => {
    const example = JSON.parse(
      await readFile(
        new URL("../../docs/schemas/examples/book.v1.json", import.meta.url),
        "utf8",
      ),
    );
    expect(validateBookDocument(example)).toMatchObject({
      schema_version: 1,
      book_id: 42,
      updated_at: 1788739200000,
    });
  });
  it("rejects unsupported versions, unknown fields and type coercion without mutating input", () => {
    for (const patch of [
      { schema_version: 0 },
      { schema_version: 2 },
      { schema_version: "1" },
      { book_id: "1" },
      { private_notes: "Private" },
    ]) {
      const input = { ...smallBook(), ...patch };
      const before = structuredClone(input);
      expect(() => validateBookDocument(input)).toThrow();
      expect(input).toEqual(before);
    }
  });
  it("rejects impossible boundaries, duplicate page aliases and aliasing a non-page heading", () => {
    const book = smallBook();
    const appendix = headingBlock("Appendix");
    book.blocks.push(appendix);
    book.publishing.boundaries = {
      body_start_block_id: appendix.id,
      appendix_start_block_id: required(book.blocks[0]).id,
    };
    expect(() => validateBookDocument(book)).toThrow();
    book.publishing.boundaries = {
      body_start_block_id: required(book.blocks[0]).id,
    };
    const first = book.blocks[0];
    if (first?.type !== "heading") throw new Error("Fixture");
    first.alias = "chapter";
    appendix.alias = "chapter";
    expect(() => validateBookDocument(book)).toThrow();
    appendix.alias = "appendix";
    appendix.starts_page = false;
    expect(() => validateBookDocument(book)).toThrow();
  });
  it("rejects broken table spans and missing footnote references", () => {
    const book = smallBook();
    const paragraph = book.blocks[1];
    if (paragraph?.type !== "paragraph") throw new Error("Fixture");
    paragraph.content = [
      { type: "footnote_reference", target_id: "blk_000000000000000000000000" },
    ];
    expect(() => validateBookDocument(book)).toThrow();
    book.blocks[1] = {
      id: paragraph.id,
      type: "table",
      rows: [[{ header: false, row_span: 2, col_span: 1, content: [] }]],
    };
    expect(() => validateBookDocument(book)).toThrow();
  });
});
