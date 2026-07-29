import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BookDetails } from "@/web/components/library/BookDetails";
import {
  createLibraryContext,
  parseLibraryContext,
} from "@/web/components/library/details-navigation";
import type { BookDetails as BookDetailsView } from "@/modules/catalog/application/public";

const details: BookDetailsView = {
  authors: ["A. Author"],
  bookId: 3,
  bookKey: "a-book",
  contributors: [],
  coverUrl: null,
  description: "Description",
  detailsUrl: "/books/a-book",
  language: "zh-CN",
  originals: [
    {
      href: "/books/a-book/originals/file_test",
      label: "Source.zip",
      mediaType: "application/zip",
      sizeBytes: 1200,
    },
  ],
  presentationDigest: "a".repeat(64),
  startUrl: "/read/a-book/1",
  subtitle: "Subtitle",
  title: "A Book",
  toc: [
    {
      href: "/read/a-book/1#blk_test",
      level: 1,
      number: "1",
      title: "Opening",
    },
  ],
  tocEntryCount: 1,
  tocTruncated: false,
  versionId: "ver_details_component_0001",
  visibility: "public",
};

describe("book details interaction", () => {
  it("renders a named open native dialog with ordinary close and reading links", () => {
    const html = renderToStaticMarkup(
      <BookDetails closeHref="/library" details={details} />,
    );
    expect(html).toContain("<dialog");
    expect(html).toContain(" open");
    expect(html).toContain('aria-labelledby="book-details-title"');
    expect(html).toContain('href="/library"');
    expect(html).toContain('href="/read/a-book/1"');
    expect(html).toContain("Source.zip");
    expect(html).toContain("1.2 KB");
  });

  it("creates and accepts only fresh same-origin library context", () => {
    const context = createLibraryContext({
      detailPath: "/books/a-book",
      nowMs: 1_000,
      openerId: "book-3-details",
      sourcePath: "/library?sort=title",
      scrollX: 0,
      scrollY: 900,
    });
    expect(
      parseLibraryContext(JSON.stringify(context), {
        currentOrigin: "https://library.example",
        detailPath: "/books/a-book",
        nowMs: 20_000,
      }),
    ).toEqual(context);
    expect(
      parseLibraryContext(JSON.stringify(context), {
        currentOrigin: "https://library.example",
        detailPath: "/books/another",
        nowMs: 20_000,
      }),
    ).toBeNull();
    expect(
      parseLibraryContext(JSON.stringify(context), {
        currentOrigin: "https://library.example",
        detailPath: "/books/a-book",
        nowMs: 700_000,
      }),
    ).toBeNull();
  });

  it("rejects external paths and unsafe opener identifiers", () => {
    expect(() =>
      createLibraryContext({
        detailPath: "https://evil.example/books/a-book",
        nowMs: 1,
        openerId: 'bad" id',
        sourcePath: "//evil.example/library",
        scrollX: 0,
        scrollY: 0,
      }),
    ).toThrow("LIBRARY_CONTEXT_INVALID");
  });
});
