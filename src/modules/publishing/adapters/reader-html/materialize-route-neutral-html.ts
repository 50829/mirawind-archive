import { parseFragment, serialize } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

import {
  parseRouteNeutralHeadingHref,
  parseRouteNeutralResourceUrl,
} from "@/modules/publishing/core/publication/route-neutral-links";

type ChildNode = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];
type UrlAttribute = Element["attrs"][number];

interface MaterializationPolicy {
  readonly headingHref: (blockId: string) => string;
  readonly resourceUrl: (resourceId: string) => string;
}

type RouteNeutralReference =
  | {
      readonly attribute: UrlAttribute;
      readonly id: string;
      readonly kind: "heading";
    }
  | {
      readonly attribute: UrlAttribute;
      readonly id: string;
      readonly kind: "resource";
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

function isElement(node: ChildNode): node is Element {
  return "tagName" in node && Array.isArray(node.attrs);
}

export function materializeRouteNeutralHtmlVariants(input: {
  readonly html: string;
  readonly preview: MaterializationPolicy;
  readonly published: MaterializationPolicy;
}): { readonly preview: string; readonly published: string } {
  const fragment = parseFragment(input.html);
  const references: RouteNeutralReference[] = [];
  const visit = (parent: ParentNode): void => {
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue;
      for (const attribute of node.attrs) {
        if (attribute.name !== "href" && attribute.name !== "src") continue;
        const headingId = parseRouteNeutralHeadingHref(attribute.value);
        if (headingId) {
          references.push({ attribute, id: headingId, kind: "heading" });
          continue;
        }
        const resourceId = parseRouteNeutralResourceUrl(attribute.value);
        if (resourceId) {
          references.push({ attribute, id: resourceId, kind: "resource" });
        }
      }
      visit(node);
      if ("content" in node) visit(node.content);
    }
  };
  visit(fragment);

  const materialize = (policy: MaterializationPolicy): string => {
    for (const reference of references) {
      const replacement =
        reference.kind === "heading"
          ? policy.headingHref(reference.id)
          : policy.resourceUrl(reference.id);
      assertSafeOutputUrl(replacement);
      reference.attribute.value = replacement;
    }
    return serialize(fragment);
  };

  return Object.freeze({
    preview: materialize(input.preview),
    published: materialize(input.published),
  });
}
