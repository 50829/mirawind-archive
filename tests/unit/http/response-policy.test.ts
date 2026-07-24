import { describe, expect, it } from "vitest";

import { SafeApplicationError } from "@/domain/errors";
import {
  applyResponsePolicy,
  cachePolicyFor,
  createSafeHtmlError,
  createSafeJsonError,
  createStrongEtag,
  requireExactOrigin,
  requireMutationOrigin,
  responsePolicyFor,
  safeErrorInputFromUnknown,
} from "@/http/response-policy";
import { createRequestContext, createRequestId } from "@/http/request-context";

describe("HTTP response policy", () => {
  it.each([
    ["draft", "private, no-store", true],
    ["hidden-or-missing", "no-store", true],
    ["login", "private, no-store", true],
    ["manage", "private, no-store", true],
    ["original-download", "private, no-store", true],
    ["private", "private, no-store", true],
    ["private-api", "private, no-store", true],
    ["public-html", "public, max-age=0, must-revalidate", false],
    [
      "public-versioned-resource",
      "private, max-age=31536000, immutable",
      false,
    ],
    ["redirect", "no-store", true],
    ["site-static", "public, max-age=31536000, immutable", false],
  ] as const)(
    "defines the complete %s response policy",
    (kind, cacheControl, indexedIsForbidden) => {
      expect(cachePolicyFor(kind)).toBe(cacheControl);
      expect(Boolean(responsePolicyFor(kind).robotsTag)).toBe(
        indexedIsForbidden,
      );
    },
  );

  it("applies and clears indexing rules with the cache policy", () => {
    const headers = new Headers();
    applyResponsePolicy(headers, "original-download");
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive, nosnippet",
    );

    applyResponsePolicy(headers, "public-html");
    expect(headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(headers.has("x-robots-tag")).toBe(false);
  });

  it("accepts only the exact configured mutation origin", () => {
    expect(() =>
      requireExactOrigin(
        "https://library.example.test",
        "https://library.example.test",
      ),
    ).not.toThrow();
    expect(() =>
      requireExactOrigin(
        "https://evil.example.test",
        "https://library.example.test",
      ),
    ).toThrow();
    expect(() =>
      requireExactOrigin(null, "https://library.example.test"),
    ).toThrow();

    expect(() =>
      requireMutationOrigin(
        new Request("https://library.example.test/api/items", {
          headers: { origin: "https://library.example.test" },
          method: "POST",
        }),
        "https://library.example.test",
      ),
    ).not.toThrow();
  });

  it("creates deterministic strong validators from the full identity", () => {
    const etag = createStrongEtag(
      "/books/book-1/chapter-1",
      "version-7",
      "renderer-3",
    );
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    expect(
      createStrongEtag("/books/book-1/chapter-1", "version-7", "renderer-3"),
    ).toBe(etag);
    expect(
      createStrongEtag("/books/book-1/chapter-2", "version-7", "renderer-3"),
    ).not.toBe(etag);
    expect(createStrongEtag("1", "23")).not.toBe(createStrongEtag("12", "3"));
  });

  it("serializes stable safe errors without leaking the cause", async () => {
    const response = createSafeJsonError({
      cause: new Error("password=secret /private/path/book.md"),
      code: "INVALID_REQUEST",
      message: "The request is invalid.",
      requestId: "req_safe",
      status: 400,
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      code: "INVALID_REQUEST",
      message: "The request is invalid.",
      request_id: "req_safe",
    });
    expect(body).not.toContain("password=secret");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("escapes safe HTML messages and never exposes exception causes", async () => {
    const response = createSafeHtmlError({
      cause: new Error("database password=secret"),
      code: "INVALID_REQUEST",
      message: "<script>alert('x')</script>",
      requestId: "req_<unsafe>",
      status: 400,
    });
    const html = await response.text();

    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).toContain("req_&lt;unsafe&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("password=secret");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("preserves declared safe errors and normalizes unknown exceptions", () => {
    expect(
      safeErrorInputFromUnknown({
        cause: new SafeApplicationError(
          "INVALID_ORIGIN",
          "The origin is invalid.",
          403,
        ),
        requestId: "req_safe",
      }),
    ).toMatchObject({
      code: "INVALID_ORIGIN",
      message: "The origin is invalid.",
      requestId: "req_safe",
      status: 403,
    });
    expect(
      safeErrorInputFromUnknown({
        cause: new Error("SQLITE_ERROR /private/db.sqlite"),
        requestId: "req_safe",
      }),
    ).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "The request could not be completed.",
      requestId: "req_safe",
      status: 500,
    });
  });
});

describe("request context", () => {
  it("uses opaque server-generated IDs instead of trusting a request header", () => {
    const context = createRequestContext(
      new Request("https://library.example.test/private?token=secret", {
        headers: { "x-request-id": "attacker-controlled" },
        method: "post",
      }),
      1234,
    );

    expect(context).toEqual({
      id: expect.stringMatching(/^req_[A-Za-z0-9_-]{24}$/),
      method: "POST",
      path: "/private",
      startedAtMs: 1234,
    });
    expect(context.id).not.toBe("attacker-controlled");
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("generates unique opaque request identifiers", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createRequestId()));
    expect(ids.size).toBe(100);
  });
});
