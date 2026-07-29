import type { APIRoute } from "astro";

import { createPublishedBookServer } from "@/composition/server";
import { resolveRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy, createStrongEtag } from "@/http/cache/policies";
import { ifNoneMatchMatches } from "@/http/conditional";
import { originalDownloadFilename } from "@/http/downloads/filename";
import { parseSingleByteRange } from "@/http/downloads/range";
import { getRuntimeStorageLayout } from "@/composition/storage";

export const prerender = false;

function baseHeaders(input: {
  readonly contentDisposition: string;
  readonly etag: string;
  readonly mediaType: string;
}): Headers {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Disposition": input.contentDisposition,
    "Content-Type": input.mediaType,
    ETag: input.etag,
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(headers, "original-download");
  return headers;
}

export const GET: APIRoute = async ({ locals, params, request }) => {
  const { database, decision } = resolveRuntimeAdministrator(locals.session);
  const layout = await getRuntimeStorageLayout();
  const publishedBook = createPublishedBookServer(database, layout);
  const original = publishedBook.resolveOriginal({
    administrator: decision,
    bookKey: params.bookKey ?? "",
    fileId: params.fileId ?? "",
  });
  const filename = originalDownloadFilename({
    bookId: original.bookId,
    mediaType: original.mediaType,
    originalName: original.originalName,
    title: original.title,
  });
  const etag = createStrongEtag("registered-original-v1", original.sha256);
  const headers = baseHeaders({
    contentDisposition: filename.contentDisposition,
    etag,
    mediaType: original.mediaType,
  });
  const rangeHeader = request.headers.get("range");
  if (
    !rangeHeader &&
    ifNoneMatchMatches(request.headers.get("if-none-match"), etag)
  ) {
    headers.delete("Content-Type");
    return new Response(null, { headers, status: 304 });
  }

  const ifRange = request.headers.get("if-range");
  const range =
    rangeHeader && ifRange && !ifNoneMatchMatches(ifRange, etag)
      ? ({ kind: "full" } as const)
      : parseSingleByteRange(rangeHeader, original.sizeBytes);
  if (range.kind === "unsatisfiable") {
    headers.delete("Content-Type");
    headers.set("Content-Range", `bytes */${original.sizeBytes}`);
    return new Response(null, { headers, status: 416 });
  }

  if (range.kind === "range") {
    headers.set("Content-Length", String(range.range.length));
    headers.set(
      "Content-Range",
      `bytes ${range.range.start}-${range.range.end}/${original.sizeBytes}`,
    );
    const body = await publishedBook.readOriginalBody(original, range.range);
    return new Response(body, { headers, status: 206 });
  }

  headers.set("Content-Length", String(original.sizeBytes));
  return new Response(await publishedBook.readOriginalBody(original), {
    headers,
  });
};
