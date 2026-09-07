import { describe, expect, it } from "vitest";

import {
  createLibraryContext,
  parseLibraryContext,
} from "@/web/components/library/details-navigation";
describe("details navigation context", () => {
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
