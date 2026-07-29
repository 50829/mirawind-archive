import { parseFragment, serialize } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

import {
  parseRouteNeutralHeadingHref,
  parseRouteNeutralResourceUrl,
} from "@/modules/publishing/core/publication/route-neutral-links";

type ChildNode = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

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

export function materializeRouteNeutralHtml(input: {
  readonly headingHref: (blockId: string) => string;
  readonly html: string;
  readonly resourceUrl: (resourceId: string) => string;
}): string {
  const fragment = parseFragment(input.html);
  const visit = (parent: ParentNode): void => {
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue;
      for (const attribute of node.attrs) {
        if (attribute.name !== "href" && attribute.name !== "src") continue;
        const headingId = parseRouteNeutralHeadingHref(attribute.value);
        const resourceId = parseRouteNeutralResourceUrl(attribute.value);
        if (!headingId && !resourceId) continue;
        const replacement = headingId
          ? input.headingHref(headingId)
          : input.resourceUrl(resourceId ?? "");
        assertSafeOutputUrl(replacement);
        attribute.value = replacement;
      }
      visit(node);
      if ("content" in node) visit(node.content);
    }
  };
  visit(fragment);
  return serialize(fragment);
}
