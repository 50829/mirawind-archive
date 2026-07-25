import { createHash } from "node:crypto";

import type { APIRoute } from "astro";

import { resolveRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { publicJsonResponse } from "@/http/cache/library-response";
import { applyResponsePolicy } from "@/http/cache/policies";
import { LibraryService } from "@/services/library";

export const prerender = false;

function detailsDigest(
  details: ReturnType<LibraryService["resolveDetails"]>,
): string {
  const hash = createHash("sha256")
    .update(details.presentationDigest)
    .update("\0")
    .update(details.versionId);
  for (const original of details.originals) {
    hash
      .update("\0")
      .update(original.href)
      .update("\0")
      .update(String(original.sizeBytes));
  }
  return hash.digest("base64url");
}

export const GET: APIRoute = ({ locals, params, request }) => {
  const requestedKey = params.bookKey ?? "";
  const { database, decision } = resolveRuntimeAdministrator(locals.session);
  const details = new LibraryService(database).resolveDetails({
    administrator: decision,
    bookKey: requestedKey,
  });
  if (requestedKey !== details.bookKey) {
    const location = new URL(
      `/api/books/${details.bookKey}/details`,
      request.url,
    );
    const headers = new Headers({ Location: location.toString() });
    applyResponsePolicy(headers, "redirect");
    return new Response(null, { headers, status: 302 });
  }
  let headers: Headers;
  if (details.visibility === "public") {
    const response = publicJsonResponse({
      digest: detailsDigest(details),
      rendererIdentity: "book-details-json-v1",
      request,
      requestPath: new URL(request.url).pathname,
    });
    if (response.notModified) return response.notModified;
    headers = response.headers;
  } else {
    headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    applyResponsePolicy(headers, "private-api");
  }
  return Response.json(
    {
      book: {
        authors: details.authors,
        book_id: details.bookId,
        book_key: details.bookKey,
        cover_url: details.coverUrl,
        description: details.description,
        language: details.language,
        start_url: details.startUrl,
        subtitle: details.subtitle,
        title: details.title,
        version_id: details.versionId,
      },
      originals: details.originals.map((original) => ({
        href: original.href,
        label: original.label,
        media_type: original.mediaType,
        size_bytes: original.sizeBytes,
      })),
      toc: details.toc,
      toc_entry_count: details.tocEntryCount,
      toc_truncated: details.tocTruncated,
    },
    { headers },
  );
};
