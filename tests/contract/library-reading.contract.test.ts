import { describe, expect, it } from "vitest";

import {
  libraryHtmlResponse,
  publicJsonResponse,
} from "@/http/cache/library-response";

describe("library HTTP contract", () => {
  it("uses strong session-independent public HTML identities", () => {
    const request = new Request("https://library.example/library");
    const first = libraryHtmlResponse({
      digest: "library-digest",
      rendererIdentity: "library-v1",
      request,
      requestPath: "/library",
      access: "public",
    });
    const second = libraryHtmlResponse({
      digest: "library-digest",
      rendererIdentity: "library-v1",
      request,
      requestPath: "/library",
      access: "public",
    });
    expect(first.etag).toBe(second.etag);
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(first.headers.has("vary")).toBe(false);
  });

  it("evaluates a matching conditional request after resolution", () => {
    const initial = libraryHtmlResponse({
      digest: "library-digest",
      rendererIdentity: "library-v1",
      request: new Request("https://library.example/library"),
      requestPath: "/library",
      access: "public",
    });
    const conditional = libraryHtmlResponse({
      digest: "library-digest",
      rendererIdentity: "library-v1",
      request: new Request("https://library.example/library", {
        headers: { "If-None-Match": initial.etag },
      }),
      requestPath: "/library",
      access: "public",
    });
    expect(conditional.notModified?.status).toBe(304);
  });

  it("marks public details JSON non-indexable", () => {
    const response = publicJsonResponse({
      digest: "details",
      rendererIdentity: "details-json-v1",
      request: new Request("https://library.example/api/books/1/details"),
      requestPath: "/api/books/1/details",
    });
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("cache-control")).toContain("public");
  });
});
