import { escapeAttribute } from "entities/escape";

import type { RouteNeutralReference } from "@/modules/publishing/core/publication/route-neutral-links";

interface MaterializationPolicy {
  readonly headingHref: (blockId: string) => string;
  readonly resourceUrl: (resourceId: string) => string;
}

function assertSafeOutputUrl(value: string): void {
  if (
    (!value.startsWith("/") && !value.startsWith("#")) ||
    value.startsWith("//") ||
    [...value].some((character) => (character.codePointAt(0) ?? 0) < 32)
  ) {
    throw new Error("MATERIALIZED_READER_URL_INVALID");
  }
}

function materialize(
  html: string,
  references: readonly RouteNeutralReference[],
  policy: MaterializationPolicy,
): string {
  const chunks: string[] = [];
  let cursor = 0;
  for (const reference of references) {
    if (
      reference.startOffset < cursor ||
      reference.endOffset < reference.startOffset ||
      reference.endOffset > html.length
    ) {
      throw new Error("ROUTE_NEUTRAL_ATTRIBUTE_LOCATION_INVALID");
    }
    if (
      html.slice(reference.startOffset, reference.endOffset) !==
      `${reference.name}="${reference.token}"`
    ) {
      throw new Error("ROUTE_NEUTRAL_ATTRIBUTE_MISMATCH");
    }
    const replacement =
      reference.kind === "heading"
        ? policy.headingHref(reference.id)
        : policy.resourceUrl(reference.id);
    assertSafeOutputUrl(replacement);
    chunks.push(
      html.slice(cursor, reference.startOffset),
      `${reference.name}="${escapeAttribute(replacement)}"`,
    );
    cursor = reference.endOffset;
  }
  chunks.push(html.slice(cursor));
  return chunks.join("");
}

export function materializeRouteNeutralHtmlVariants(input: {
  readonly html: string;
  readonly preview: MaterializationPolicy;
  readonly published: MaterializationPolicy;
  readonly references: readonly RouteNeutralReference[];
}): { readonly preview: string; readonly published: string } {
  return Object.freeze({
    preview: materialize(input.html, input.references, input.preview),
    published: materialize(input.html, input.references, input.published),
  });
}
