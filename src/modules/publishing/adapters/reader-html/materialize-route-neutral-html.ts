import { escapeAttribute } from "entities/escape";
import type { Token } from "parse5";
import { SAXParser, type StartTag } from "parse5-sax-parser";

import {
  parseRouteNeutralHeadingHref,
  parseRouteNeutralResourceUrl,
} from "@/modules/publishing/core/publication/route-neutral-links";

interface MaterializationPolicy {
  readonly headingHref: (blockId: string) => string;
  readonly resourceUrl: (resourceId: string) => string;
}

type RouteNeutralReference =
  | {
      readonly endOffset: number;
      readonly id: string;
      readonly kind: "heading";
      readonly name: "href" | "src";
      readonly startOffset: number;
    }
  | {
      readonly endOffset: number;
      readonly id: string;
      readonly kind: "resource";
      readonly name: "href" | "src";
      readonly startOffset: number;
    };

function assertSafeOutputUrl(value: string): void {
  if (
    (!value.startsWith("/") && !value.startsWith("#")) ||
    value.startsWith("//") ||
    [...value].some((character) => (character.codePointAt(0) ?? 0) < 32)
  ) {
    throw new Error("MATERIALIZED_READER_URL_INVALID");
  }
}

function routeNeutralReference(
  attribute: StartTag["attrs"][number],
  location: { readonly endOffset: number; readonly startOffset: number },
): RouteNeutralReference | null {
  if (attribute.name !== "href" && attribute.name !== "src") return null;
  const headingId = parseRouteNeutralHeadingHref(attribute.value);
  if (headingId) {
    return Object.freeze({
      endOffset: location.endOffset,
      id: headingId,
      kind: "heading",
      name: attribute.name,
      startOffset: location.startOffset,
    });
  }
  const resourceId = parseRouteNeutralResourceUrl(attribute.value);
  return resourceId
    ? Object.freeze({
        endOffset: location.endOffset,
        id: resourceId,
        kind: "resource",
        name: attribute.name,
        startOffset: location.startOffset,
      })
    : null;
}

async function parseRouteNeutralReferences(
  html: string,
): Promise<readonly RouteNeutralReference[]> {
  const references: RouteNeutralReference[] = [];
  const parser = new SAXParser({ sourceCodeLocationInfo: true });
  parser.on("startTag", (tag) => {
    const locations = (
      tag.sourceCodeLocation as Token.LocationWithAttributes | null | undefined
    )?.attrs;
    for (const attribute of tag.attrs) {
      if (attribute.name !== "href" && attribute.name !== "src") continue;
      const location = locations?.[attribute.name];
      if (!location)
        throw new Error("ROUTE_NEUTRAL_ATTRIBUTE_LOCATION_MISSING");
      const reference = routeNeutralReference(attribute, location);
      if (reference) references.push(reference);
    }
  });
  await new Promise<void>((resolve, reject) => {
    parser.once("error", reject);
    parser.end(html, resolve);
  });
  return Object.freeze(references);
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

export async function materializeRouteNeutralHtmlVariants(input: {
  readonly html: string;
  readonly preview: MaterializationPolicy;
  readonly published: MaterializationPolicy;
}): Promise<{ readonly preview: string; readonly published: string }> {
  const references = await parseRouteNeutralReferences(input.html);
  return Object.freeze({
    preview: materialize(input.html, references, input.preview),
    published: materialize(input.html, references, input.published),
  });
}
