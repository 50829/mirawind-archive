import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  libraryHtmlResponse,
  publicJsonResponse,
} from "@/http/cache/library-response";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("library HTTP contract", () => {
  it("uses strong session-independent public HTML identities", () => {
    const request = new Request("https://library.example/library");
    const first = libraryHtmlResponse({
      digest: "library-digest",
      rendererIdentity: "library-v1",
      request,
      requestPath: "/library",
      visibility: "public",
    });
    const second = libraryHtmlResponse({
      digest: "library-digest",
      rendererIdentity: "library-v1",
      request,
      requestPath: "/library",
      visibility: "public",
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
      visibility: "public",
    });
    const conditional = libraryHtmlResponse({
      digest: "library-digest",
      rendererIdentity: "library-v1",
      request: new Request("https://library.example/library", {
        headers: { "If-None-Match": initial.etag },
      }),
      requestPath: "/library",
      visibility: "public",
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

  it("declares canonical, noindex and private boundaries in route sources", async () => {
    const [library, details, privateApi] = await Promise.all([
      readFile(`${projectRoot}src/pages/library/index.astro`, "utf8"),
      readFile(`${projectRoot}src/pages/books/[bookKey]/index.astro`, "utf8"),
      readFile(`${projectRoot}src/pages/api/manage/library.ts`, "utf8"),
    ]);
    expect(library).toContain('rel="canonical"');
    expect(details).toContain('rel="canonical"');
    expect(privateApi).toContain('"private-api"');
  });
});
