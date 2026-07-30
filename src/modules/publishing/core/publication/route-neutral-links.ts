const blockIdPattern = /^blk_[A-Za-z0-9_-]{16,80}$/u;
const resourceIdPattern = /^res_[A-Za-z0-9_-]{16,80}$/u;
const scopeIdPattern = /^[A-Za-z0-9_-]{16,96}$/u;

export type RouteNeutralReference = Readonly<{
  endOffset: number;
  id: string;
  kind: "heading" | "resource";
  name: "href" | "src";
  startOffset: number;
  token: string;
}>;

export interface RouteNeutralLinkScope {
  readonly headingHref: (blockId: string) => string;
  readonly referencesIn: (html: string) => readonly RouteNeutralReference[];
  readonly resourceUrl: (resourceId: string) => string;
}

function attributeAt(
  html: string,
  tokenStart: number,
): { readonly name: "href" | "src"; readonly startOffset: number } | null {
  for (const name of ["href", "src"] as const) {
    const marker = `${name}="`;
    const startOffset = tokenStart - marker.length;
    if (startOffset >= 0 && html.slice(startOffset, tokenStart) === marker) {
      return Object.freeze({ name, startOffset });
    }
  }
  return null;
}

export function createRouteNeutralLinkScope(
  scopeId: string,
): RouteNeutralLinkScope {
  if (!scopeIdPattern.test(scopeId)) {
    throw new Error("ROUTE_NEUTRAL_SCOPE_ID_INVALID");
  }
  const scopePrefix = `/__mirawind__/${scopeId}/`;
  const headingPrefix = `${scopePrefix}headings/`;
  const resourcePrefix = `${scopePrefix}resources/`;

  const headingHref = (blockId: string): string => {
    if (!blockIdPattern.test(blockId)) {
      throw new Error("ROUTE_NEUTRAL_HEADING_ID_INVALID");
    }
    return `${headingPrefix}${blockId}`;
  };
  const resourceUrl = (resourceId: string): string => {
    if (!resourceIdPattern.test(resourceId)) {
      throw new Error("ROUTE_NEUTRAL_RESOURCE_ID_INVALID");
    }
    return `${resourcePrefix}${resourceId}`;
  };
  const referencesIn = (html: string): readonly RouteNeutralReference[] => {
    const references: RouteNeutralReference[] = [];
    let cursor = 0;
    for (;;) {
      const tokenStart = html.indexOf(scopePrefix, cursor);
      if (tokenStart < 0) break;
      const attribute = attributeAt(html, tokenStart);
      if (!attribute) {
        cursor = tokenStart + scopePrefix.length;
        continue;
      }
      const tokenEnd = html.indexOf('"', tokenStart);
      if (tokenEnd < 0) {
        throw new Error("ROUTE_NEUTRAL_ATTRIBUTE_UNTERMINATED");
      }
      const token = html.slice(tokenStart, tokenEnd);
      const heading = token.startsWith(headingPrefix);
      const resource = token.startsWith(resourcePrefix);
      if (!heading && !resource) {
        throw new Error("ROUTE_NEUTRAL_TOKEN_KIND_INVALID");
      }
      const id = token.slice((heading ? headingPrefix : resourcePrefix).length);
      if (!(heading ? blockIdPattern : resourceIdPattern).test(id)) {
        throw new Error(
          heading
            ? "ROUTE_NEUTRAL_HEADING_TOKEN_INVALID"
            : "ROUTE_NEUTRAL_RESOURCE_TOKEN_INVALID",
        );
      }
      references.push(
        Object.freeze({
          endOffset: tokenEnd + 1,
          id,
          kind: heading ? "heading" : "resource",
          name: attribute.name,
          startOffset: attribute.startOffset,
          token,
        }),
      );
      cursor = tokenEnd + 1;
    }
    return Object.freeze(references);
  };

  return Object.freeze({ headingHref, referencesIn, resourceUrl });
}
