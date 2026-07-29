import { describe, expect, it } from "vitest";

import { materializeRouteNeutralHtml } from "@/modules/publishing/adapters/reader-html/materialize-route-neutral-html";
import {
  routeNeutralHeadingHref,
  routeNeutralResourceUrl,
} from "@/modules/publishing/core/publication/route-neutral-links";

describe("route-neutral reader HTML materialization", () => {
  it("rewrites only parsed URL attributes and leaves hostile-looking text unchanged", () => {
    const headingId = "blk_0123456789abcdefghijkl";
    const resourceId = "res_0123456789abcdefghijkl";
    const headingToken = routeNeutralHeadingHref(headingId);
    const resourceToken = routeNeutralResourceUrl(resourceId);
    const result = materializeRouteNeutralHtml({
      headingHref: (blockId) => `/read/book/2#${blockId}`,
      html: `<p><a href="${headingToken}">next</a><img src="${resourceToken}" alt="x"></p><pre>href="${headingToken}" src="${resourceToken}"</pre>`,
      resourceUrl: (id) => `/books/1/assets/ver_123/${id}`,
    });

    expect(result).toContain(`<a href="/read/book/2#${headingId}">next</a>`);
    expect(result).toContain(
      `<img src="/books/1/assets/ver_123/${resourceId}" alt="x">`,
    );
    expect(result).toContain(
      `<pre>href="${headingToken}" src="${resourceToken}"</pre>`,
    );
  });

  it("rejects unsafe materialized URLs", () => {
    const headingId = "blk_0123456789abcdefghijkl";
    expect(() =>
      materializeRouteNeutralHtml({
        headingHref: () => "https://example.test/unsafe",
        html: `<a href="${routeNeutralHeadingHref(headingId)}">next</a>`,
        resourceUrl: () => "/asset",
      }),
    ).toThrow("MATERIALIZED_READER_URL_INVALID");
  });
});
