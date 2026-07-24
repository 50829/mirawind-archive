import { describe, expect, it } from "vitest";

import {
  cachePolicyFor,
  createSafeJsonError,
  requireExactOrigin,
} from "@/http/response-policy";

describe("HTTP response policy", () => {
  it.each(["draft", "private", "login", "manage", "private-api"] as const)(
    "makes %s responses private and non-storable",
    (kind) => {
      expect(cachePolicyFor(kind)).toBe("private, no-store");
    },
  );

  it("keeps hidden and missing responses non-cacheable", () => {
    expect(cachePolicyFor("hidden-or-missing")).toBe("no-store");
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
    expect(await response.json()).toEqual({
      code: "INVALID_REQUEST",
      message: "The request is invalid.",
      request_id: "req_safe",
    });
  });
});
