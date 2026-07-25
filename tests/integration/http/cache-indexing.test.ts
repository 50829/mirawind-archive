import { describe, expect, it } from "vitest";

import {
  createSafeHtmlError,
  createSafeJsonError,
} from "@/http/errors/responses";
import {
  immutableAssetHeaders,
  readingPageHeaders,
} from "@/http/cache/reading-response";
import {
  libraryHtmlResponse,
  publicJsonResponse,
} from "@/http/cache/library-response";

describe("public/private cache and indexing boundaries", () => {
  it("uses current library/detail digests and route paths in strong identities", () => {
    const request = new Request("https://library.example/library");
    const baseline = libraryHtmlResponse({
      digest: "books-v1",
      rendererIdentity: "library-v1",
      request,
      requestPath: "/library",
      visibility: "public",
    });
    expect(baseline.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(
      libraryHtmlResponse({
        digest: "books-v2",
        rendererIdentity: "library-v1",
        request,
        requestPath: "/library",
        visibility: "public",
      }).etag,
    ).not.toBe(baseline.etag);
    const details = publicJsonResponse({
      digest: "details-v1",
      rendererIdentity: "details-json-v1",
      request: new Request("https://library.example/api/books/book/details"),
      requestPath: "/api/books/book/details",
    });
    expect(details.headers.get("x-robots-tag")).toContain("noindex");
    expect(details.headers.has("vary")).toBe(false);
  });

  it("makes public page ETags route, version and renderer specific", () => {
    const baseline = readingPageHeaders({
      pageIdentity: "1",
      rendererVersion: "renderer-v1",
      requestPath: "/read/1/1",
      versionId: "ver_cache_headers_test_0001",
      visibility: "public",
    });
    expect(baseline.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(baseline.headers.get("x-robots-tag")).toBeNull();
    for (const change of [
      { requestPath: "/read/book-alias/1" },
      { versionId: "ver_cache_headers_test_0002" },
      { rendererVersion: "renderer-v2" },
    ]) {
      expect(
        readingPageHeaders({
          pageIdentity: "1",
          rendererVersion: "renderer-v1",
          requestPath: "/read/1/1",
          versionId: "ver_cache_headers_test_0001",
          visibility: "public",
          ...change,
        }).etag,
      ).not.toBe(baseline.etag);
    }
  });

  it("uses no-store for private HTML and browser-only immutable asset caching", () => {
    expect(
      readingPageHeaders({
        pageIdentity: "1",
        rendererVersion: "renderer-v1",
        requestPath: "/read/1/1",
        versionId: "ver_cache_headers_test_0001",
        visibility: "private",
      }).headers.get("cache-control"),
    ).toBe("private, no-store");
    expect(
      immutableAssetHeaders({
        mediaType: "image/png",
        sha256: "a".repeat(64),
        sizeBytes: 1,
        visibility: "public",
      }).headers.get("cache-control"),
    ).toBe("private, max-age=31536000, immutable");
    expect(
      immutableAssetHeaders({
        mediaType: "image/png",
        sha256: "a".repeat(64),
        sizeBytes: 1,
        visibility: "private",
      }).headers.get("cache-control"),
    ).toBe("private, no-store");
  });

  it("makes hidden and unavailable responses non-cacheable and non-indexable", async () => {
    const hidden = createSafeHtmlError({
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
      policy: "hidden-or-missing",
      requestId: "req_cache_test",
      status: 404,
    });
    expect(hidden.headers.get("cache-control")).toBe("no-store");
    expect(hidden.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive, nosnippet",
    );
    expect(await hidden.text()).toContain('content="noindex,nofollow"');

    const unavailable = createSafeJsonError({
      code: "BOOK_UNAVAILABLE",
      message: "This book is temporarily unavailable.",
      policy: "hidden-or-missing",
      requestId: "req_cache_test",
      status: 503,
    });
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    expect(unavailable.headers.get("retry-after")).toBe("30");
  });
});
