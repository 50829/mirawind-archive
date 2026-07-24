import { applyResponsePolicy, createStrongEtag } from "./policies.js";
import { ifNoneMatchMatches } from "../conditional.js";
import type { BookVisibility } from "../authorization/book-guard.js";

export function readingPageHeaders(input: {
  readonly pageIdentity: string;
  readonly rendererVersion: string;
  readonly requestPath: string;
  readonly versionId: string;
  readonly visibility: BookVisibility;
}): { readonly etag: string; readonly headers: Headers } {
  const etag = createStrongEtag(
    "published-page-v1",
    input.versionId,
    input.requestPath,
    input.pageIdentity,
    input.rendererVersion,
  );
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(
    headers,
    input.visibility === "public" ? "public-html" : "private",
  );
  return Object.freeze({ etag, headers });
}

export function immutableAssetHeaders(input: {
  readonly mediaType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly visibility: BookVisibility;
}): { readonly etag: string; readonly headers: Headers } {
  const etag = createStrongEtag("published-asset-v1", input.sha256);
  const headers = new Headers({
    "Content-Length": String(input.sizeBytes),
    "Content-Type": input.mediaType,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(
    headers,
    input.visibility === "public" ? "public-versioned-resource" : "private",
  );
  return Object.freeze({ etag, headers });
}

export function conditionalNotModified(
  request: Request,
  etag: string,
  headers: Headers,
): Response | null {
  if (!ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return null;
  }
  const responseHeaders = new Headers(headers);
  responseHeaders.delete("Content-Length");
  responseHeaders.delete("Content-Type");
  return new Response(null, { headers: responseHeaders, status: 304 });
}
