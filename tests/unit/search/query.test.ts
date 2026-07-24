import { describe, expect, it } from "vitest";

import { normalizeSearchQuery } from "@/compiler/search/query";

describe("public search query normalization", () => {
  it("normalizes NFC and newlines before selecting scope by Unicode code points", () => {
    expect(normalizeSearchQuery(" e\u0301\r\n中 ")).toMatchObject({
      codePointLength: 3,
      normalized: "é\n中",
      scope: "metadata_heading_body",
    });
    expect(normalizeSearchQuery("😀")).toMatchObject({
      codePointLength: 1,
      scope: "metadata_heading_only",
    });
  });

  it("encodes FTS5 syntax as one literal phrase", () => {
    expect(normalizeSearchQuery('a" OR *').ftsLiteralPhrase).toBe('"a"" OR *"');
  });

  it("rejects empty and overlong normalized queries", () => {
    expect(() => normalizeSearchQuery(" \r\n ")).toThrow(
      /SEARCH_QUERY_LENGTH_INVALID/u,
    );
    expect(() => normalizeSearchQuery("中".repeat(201))).toThrow(
      /SEARCH_QUERY_LENGTH_INVALID/u,
    );
  });
});
