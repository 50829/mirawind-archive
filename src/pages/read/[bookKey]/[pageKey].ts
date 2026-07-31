import type { APIRoute } from "astro";

import { createPublishedBookServer } from "@/composition/server";
import { resolveRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import {
  conditionalNotModified,
  readingPageHeaders,
} from "@/http/cache/reading-response";
import { getRuntimeStorageLayout } from "@/composition/storage";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params, request }) => {
  const bookKey = params.bookKey ?? "";
  const pageKey = params.pageKey ?? "";
  const { database, decision } = resolveRuntimeAdministrator(locals.session);
  const layout = await getRuntimeStorageLayout();
  const publishedBook = createPublishedBookServer(database, layout);
  const page = await publishedBook.resolvePage({
    administrator: decision,
    bookKey,
    pageKey,
  });
  const canonicalBookKey = page.alias ?? String(page.bookId);
  const canonicalPageKey = page.pageAlias ?? String(page.pageId);
  if (bookKey !== canonicalBookKey || pageKey !== canonicalPageKey) {
    const current = new URL(request.url);
    const location = new URL(
      `/read/${canonicalBookKey}/${canonicalPageKey}`,
      current,
    );
    location.search = current.search;
    location.hash = current.hash;
    const headers = new Headers({ Location: location.toString() });
    applyResponsePolicy(headers, "redirect");
    return new Response(null, { headers, status: 302 });
  }
  const response = readingPageHeaders({
    access: page.access,
    pageIdentity: String(page.pageId),
    rendererVersion: page.rendererVersion,
    requestPath: new URL(request.url).pathname,
    versionId: page.versionId,
  });
  const notModified = conditionalNotModified(
    request,
    response.etag,
    response.headers,
  );
  if (notModified) return notModified;

  return new Response(await publishedBook.readPageHtml(page), {
    headers: response.headers,
  });
};
