import { required } from "../../helpers/required";
import { describe, expect, it } from "vitest";
import { deriveBookVersionPresentation } from "@/modules/publishing/application/publishing-api";
import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import { buildDocumentManifest } from "@/modules/publishing/core/publication/manifest";
import { smallBook, headingBlock } from "../../helpers/ir-book";
const versionId = "ver_0123456789abcdefghij";
const resourceId = "res_0123456789abcdefghij";
function fixture(tocSize = 1, includeCover = true) {
  const book = smallBook();
  book.alias = "example-book";
  book.metadata = {
    title: "Example Book",
    authors: ["Author"],
    description: "A bounded description.",
    language: "en",
    cover_resource_id: resourceId,
  };
  book.resources = [
    { id: resourceId, path: "assets/cover.png", media_type: "image/png" },
  ];
  book.blocks = Array.from({ length: tocSize }, (_, index) =>
    headingBlock(`Chapter ${index + 1}`),
  );
  book.publishing.numbering = "generated";
  book.publishing.boundaries.body_start_block_id = required(book.blocks[0]).id;
  const manifest = buildDocumentManifest({
    book: compileBook(book),
    bookId: 1,
    createdAt: "2026-09-07T00:00:00.000Z",
    versionId,
    resources: includeCover
      ? [
          {
            id: resourceId,
            absolutePath: "/private/cover.png",
            originalUrl: "assets/cover.png",
            relativePath: "assets/cover.png",
            outputPath: `published/assets/${resourceId}`,
            mediaType: "image/png",
            sha256: "b".repeat(64),
            size: 1000,
            height: 100,
            width: 80,
          },
        ]
      : [],
  });
  return { book, manifest };
}
describe("book version presentation projection", () => {
  it("derives deterministic version metadata and navigation", () => {
    const { book, manifest } = fixture();
    const first = deriveBookVersionPresentation({
      bookDocument: book,
      documentManifest: manifest,
      createdAtMs: 1000,
    });
    const second = deriveBookVersionPresentation({
      bookDocument: book,
      documentManifest: manifest,
      createdAtMs: 2000,
    });
    expect(first).toMatchObject({
      alias: "example-book",
      bookId: 1,
      sourceUpdatedAt: 1000,
      coverResourceId: resourceId,
      firstPageAlias: null,
      firstPageId: 1,
      projectionSchemaVersion: 3,
      title: "Example Book",
      tocEntryCount: 1,
      versionId,
    });
    expect(JSON.parse(first.metadataJson)).toEqual({
      authors: ["Author"],
      description: "A bounded description.",
      language: "en",
    });
    expect(JSON.parse(first.tocPreviewJson)).toEqual(manifest.toc);
    expect(first.projectionSha256).toBe(second.projectionSha256);
    expect(first.createdAtMs).not.toBe(second.createdAtMs);
  });
  it("caps the preview and replaces an unavailable cover with a placeholder", () => {
    const { book, manifest } = fixture(201, false);
    const result = deriveBookVersionPresentation({
      bookDocument: book,
      documentManifest: manifest,
      createdAtMs: 1000,
    });
    expect(result.coverResourceId).toBeNull();
    expect(result.tocEntryCount).toBe(201);
    expect(JSON.parse(result.tocPreviewJson)).toHaveLength(200);
    expect(Buffer.byteLength(result.metadataJson)).toBeLessThanOrEqual(65536);
    expect(Buffer.byteLength(result.tocPreviewJson)).toBeLessThanOrEqual(
      262144,
    );
  });
  it("rejects document and manifest identities that do not match", () => {
    const { book, manifest } = fixture();
    expect(() =>
      deriveBookVersionPresentation({
        bookDocument: { ...book, book_id: 2 },
        documentManifest: manifest,
        createdAtMs: 1000,
      }),
    ).toThrow("PRESENTATION_IDENTITY_MISMATCH");
    expect(() =>
      deriveBookVersionPresentation({
        bookDocument: { ...book, updated_at: 2000 },
        documentManifest: manifest,
        createdAtMs: 1000,
      }),
    ).toThrow("PRESENTATION_IDENTITY_MISMATCH");
  });
});
