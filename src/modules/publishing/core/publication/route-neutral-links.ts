const headingPrefix = "/__mirawind__/headings/";
const resourcePrefix = "/__mirawind__/resources/";

const blockIdPattern = /^blk_[A-Za-z0-9_-]{16,80}$/u;
const resourceIdPattern = /^res_[A-Za-z0-9_-]{16,80}$/u;

export function routeNeutralHeadingHref(blockId: string): string {
  if (!blockIdPattern.test(blockId)) {
    throw new Error("ROUTE_NEUTRAL_HEADING_ID_INVALID");
  }
  return `${headingPrefix}${blockId}`;
}

export function routeNeutralResourceUrl(resourceId: string): string {
  if (!resourceIdPattern.test(resourceId)) {
    throw new Error("ROUTE_NEUTRAL_RESOURCE_ID_INVALID");
  }
  return `${resourcePrefix}${resourceId}`;
}

export function parseRouteNeutralHeadingHref(value: string): string | null {
  if (!value.startsWith(headingPrefix)) return null;
  const blockId = value.slice(headingPrefix.length);
  if (!blockIdPattern.test(blockId)) {
    throw new Error("ROUTE_NEUTRAL_HEADING_TOKEN_INVALID");
  }
  return blockId;
}

export function parseRouteNeutralResourceUrl(value: string): string | null {
  if (!value.startsWith(resourcePrefix)) return null;
  const resourceId = value.slice(resourcePrefix.length);
  if (!resourceIdPattern.test(resourceId)) {
    throw new Error("ROUTE_NEUTRAL_RESOURCE_TOKEN_INVALID");
  }
  return resourceId;
}
