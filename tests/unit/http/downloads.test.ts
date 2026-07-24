import { describe, expect, it } from "vitest";

import { originalDownloadFilename } from "@/http/downloads/filename";
import { parseSingleByteRange } from "@/http/downloads/range";

describe("original download filename", () => {
  it("emits a safe ASCII fallback and RFC 5987 UTF-8 MinerU name", () => {
    expect(
      originalDownloadFilename({
        bookId: 42,
        mediaType: "application/zip",
        originalName: "../../unsafe.zip",
        title: ' 教材/"第一册";\n ',
      }),
    ).toEqual({
      ascii: "book-42.zip",
      contentDisposition:
        "attachment; filename=\"book-42.zip\"; filename*=UTF-8''%E6%95%99%E6%9D%90%20%E7%AC%AC%E4%B8%80%E5%86%8C-mineru.zip",
      utf8: "教材 第一册-mineru.zip",
    });
  });
});

describe("strict single byte ranges", () => {
  it("supports closed, open and suffix ranges", () => {
    expect(parseSingleByteRange("bytes=2-5", 10)).toEqual({
      kind: "range",
      range: { end: 5, length: 4, start: 2 },
    });
    expect(parseSingleByteRange("bytes=7-", 10)).toEqual({
      kind: "range",
      range: { end: 9, length: 3, start: 7 },
    });
    expect(parseSingleByteRange("bytes=-4", 10)).toEqual({
      kind: "range",
      range: { end: 9, length: 4, start: 6 },
    });
    expect(parseSingleByteRange("bytes=7-99", 10)).toEqual({
      kind: "range",
      range: { end: 9, length: 3, start: 7 },
    });
  });

  it("rejects malformed, multiple, reversed, empty and out-of-bounds ranges", () => {
    for (const value of [
      "items=0-1",
      "bytes=0-1,3-4",
      "bytes=5-2",
      "bytes=-0",
      "bytes=10-",
    ]) {
      expect(parseSingleByteRange(value, 10)).toEqual({
        kind: "unsatisfiable",
      });
    }
    expect(parseSingleByteRange("bytes=0-1", 0)).toEqual({
      kind: "unsatisfiable",
    });
  });
});
