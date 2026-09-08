import { describe, expect, it } from "vitest";

import { materializeRouteNeutralHtmlVariants } from "@/modules/publishing/adapters/reader-html/materialize-route-neutral-html";
import { createRouteNeutralLinkScope } from "@/modules/publishing/core/publication/route-neutral-links";

describe("route-neutral reader HTML materialization", () => {
  it("materializes both route policies while leaving hostile-looking text unchanged", () => {
    const headingId = "blk_0123456789abcdefghijkl";
    const resourceId = "res_0123456789abcdefghijkl";
    const routeLinks = createRouteNeutralLinkScope("scope_primary_0123456789");
    const headingToken = routeLinks.blockHref(headingId);
    const resourceToken = routeLinks.resourceUrl(resourceId);
    const textRouteLinks = createRouteNeutralLinkScope(
      "scope_text_0123456789012",
    );
    const textHeadingToken = textRouteLinks.blockHref(headingId);
    const textResourceToken = textRouteLinks.resourceUrl(resourceId);
    const html = `<p><a href="${headingToken}">next</a><img src="${resourceToken}" alt="x"></p><pre>href="${textHeadingToken}" src="${textResourceToken}"</pre>`;
    const result = materializeRouteNeutralHtmlVariants({
      html,
      preview: {
        blockHref: (blockId) => `/preview/book/2#${blockId}`,
        resourceUrl: (id) => `/preview/assets/${id}?name="x"&raw=1`,
      },
      published: {
        blockHref: (blockId) => `/read/book/2#${blockId}`,
        resourceUrl: (id) => `/books/1/assets/ver_123/${id}`,
      },
      references: routeLinks.referencesIn(html),
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
    for (const materialized of [result.preview, result.published]) {
      expect(materialized).toContain(
        `<pre>href="${textHeadingToken}" src="${textResourceToken}"</pre>`,
      );
    }
  });

  it.each(["preview", "published"] as const)(
    "rejects an unsafe %s URL",
    (unsafePolicy) => {
      const headingId = "blk_0123456789abcdefghijkl";
      const routeLinks = createRouteNeutralLinkScope("scope_unsafe_0123456789");
      const html = `<a href="${routeLinks.blockHref(headingId)}">next</a>`;
      const safePolicy = {
        blockHref: () => "/safe",
        resourceUrl: () => "/asset",
      };
      const unsafe = {
        blockHref: () => "https://example.test/unsafe",
        resourceUrl: () => "/asset",
      };
      expect(() =>
        materializeRouteNeutralHtmlVariants({
          html,
          preview: unsafePolicy === "preview" ? unsafe : safePolicy,
          published: unsafePolicy === "published" ? unsafe : safePolicy,
          references: routeLinks.referencesIn(html),
        }),
      ).toThrow("MATERIALIZED_READER_URL_INVALID");
    },
  );

  it("rejects malformed route-neutral tokens", () => {
    const headingId = "blk_0123456789abcdefghijkl";
    const routeLinks = createRouteNeutralLinkScope("scope_malformed_01234567");
    const html = `<a href="${routeLinks.blockHref(headingId)}-invalid!">next</a>`;
    expect(() => routeLinks.referencesIn(html)).toThrow(
      "ROUTE_NEUTRAL_HEADING_TOKEN_INVALID",
    );
  });
});
