export const noIndexRobotsTag =
  "noindex, nofollow, noarchive, nosnippet" as const;

export function robotsMetaContent(indexable: boolean): string {
  return indexable ? "index,follow" : "noindex,nofollow";
}
