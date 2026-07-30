import { describe, expect, it } from "vitest";

import { materializeRouteNeutralHtmlVariants } from "@/modules/publishing/adapters/reader-html/materialize-route-neutral-html";
import {
  routeNeutralHeadingHref,
  routeNeutralResourceUrl,
} from "@/modules/publishing/core/publication/route-neutral-links";

describe("route-neutral reader HTML materialization", () => {
  it("materializes both route policies while leaving hostile-looking text unchanged", async () => {
    const headingId = "blk_0123456789abcdefghijkl";
    const resourceId = "res_0123456789abcdefghijkl";
    const headingToken = routeNeutralHeadingHref(headingId);
    const resourceToken = routeNeutralResourceUrl(resourceId);
    const result = await materializeRouteNeutralHtmlVariants({
      html: `<p><a href="${headingToken}">next</a><img src="${resourceToken}" alt="x"></p><pre>href="${headingToken}" src="${resourceToken}"</pre>`,
      preview: {
        headingHref: (blockId) => `/preview/book/2#${blockId}`,
        resourceUrl: (id) => `/preview/assets/${id}?name="x"&raw=1`,
      },
      published: {
        headingHref: (blockId) => `/read/book/2#${blockId}`,
        resourceUrl: (id) => `/books/1/assets/ver_123/${id}`,
      },
    });

    expect(result.preview).toContain(
      `<a href="/preview/book/2#${headingId}">next</a>`,
    );
    expect(result.preview).toContain(
      `<img src="/preview/assets/${resourceId}?name=&quot;x&quot;&amp;raw=1" alt="x">`,
    );
    expect(result.published).toContain(
      `<a href="/read/book/2#${headingId}">next</a>`,
    );
    expect(result.published).toContain(
      `<img src="/books/1/assets/ver_123/${resourceId}" alt="x">`,
    );
    for (const html of [result.preview, result.published]) {
      expect(html).toContain(
        `<pre>href="${headingToken}" src="${resourceToken}"</pre>`,
      );
    }
  });

  it.each(["preview", "published"] as const)(
    "rejects an unsafe %s URL",
    async (unsafePolicy) => {
      const headingId = "blk_0123456789abcdefghijkl";
      const safePolicy = {
        headingHref: () => "/safe",
        resourceUrl: () => "/asset",
      };
      const unsafe = {
        headingHref: () => "https://example.test/unsafe",
        resourceUrl: () => "/asset",
      };
      await expect(
        materializeRouteNeutralHtmlVariants({
          html: `<a href="${routeNeutralHeadingHref(headingId)}">next</a>`,
          preview: unsafePolicy === "preview" ? unsafe : safePolicy,
          published: unsafePolicy === "published" ? unsafe : safePolicy,
        }),
      ).rejects.toThrow("MATERIALIZED_READER_URL_INVALID");
    },
  );

  it("rejects malformed route-neutral tokens", async () => {
    const headingId = "blk_0123456789abcdefghijkl";
    await expect(
      materializeRouteNeutralHtmlVariants({
        html: `<a href="${routeNeutralHeadingHref(headingId)}-invalid!">next</a>`,
        preview: {
          headingHref: () => "/safe",
          resourceUrl: () => "/asset",
        },
        published: {
          headingHref: () => "/safe",
          resourceUrl: () => "/asset",
        },
      }),
    ).rejects.toThrow("ROUTE_NEUTRAL_HEADING_TOKEN_INVALID");
  });
});
