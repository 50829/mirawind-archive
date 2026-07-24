import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "@/observability/logger";

describe("structured log redaction", () => {
  it("redacts credentials, cookies, authorization, body content, and unsafe paths", () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createLogger({
      destination,
      service: "test",
    });

    logger.info({
      authorization: "Bearer secret",
      cookie: "session=secret",
      markdown: "private body",
      password: "secret",
      rawArchivePath: "../../private/book.md",
      requestId: "req_visible",
    });

    expect(output).toContain("req_visible");
    expect(output).not.toContain("Bearer secret");
    expect(output).not.toContain("session=secret");
    expect(output).not.toContain("private body");
    expect(output).not.toContain("../../private/book.md");
    expect(output).not.toContain('"password":"secret"');
  });
});
