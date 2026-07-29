import { noIndexRobotsTag } from "@/http/seo/robots";
import { ifNoneMatchMatches } from "@/http/conditional";
import { applyResponsePolicy, createStrongEtag } from "@/http/cache/policies";

export interface ConditionalResponseHeaders {
  readonly etag: string;
  readonly headers: Headers;
  readonly notModified: Response | null;
}

function conditional(
  request: Request,
  etag: string,
  headers: Headers,
): Response | null {
  if (!ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return null;
  }
  const responseHeaders = new Headers(headers);
  responseHeaders.delete("Content-Type");
  return new Response(null, { headers: responseHeaders, status: 304 });
}

export function libraryHtmlResponse(input: {
  readonly digest: string;
  readonly rendererIdentity: string;
  readonly request: Request;
  readonly requestPath: string;
  readonly visibility: "private" | "public";
}): ConditionalResponseHeaders {
  const etag = createStrongEtag(
    "library-html-v1",
    input.rendererIdentity,
    input.requestPath,
    input.digest,
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
  return Object.freeze({
    etag,
    headers,
    notModified: conditional(input.request, etag, headers),
  });
}

export function publicJsonResponse(input: {
  readonly digest: string;
  readonly rendererIdentity: string;
  readonly request: Request;
  readonly requestPath: string;
}): ConditionalResponseHeaders {
  const etag = createStrongEtag(
    "library-json-v1",
    input.rendererIdentity,
    input.requestPath,
    input.digest,
  );
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": noIndexRobotsTag,
  });
  applyResponsePolicy(headers, "public-html");
  headers.set("X-Robots-Tag", noIndexRobotsTag);
  return Object.freeze({
    etag,
    headers,
    notModified: conditional(input.request, etag, headers),
  });
}
