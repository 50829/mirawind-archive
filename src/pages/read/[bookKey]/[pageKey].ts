import { readFile } from "node:fs/promises";

import type { APIRoute } from "astro";

import { SafeApplicationError } from "@/domain/errors";
import { resolveRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import {
  conditionalNotModified,
  readingPageHeaders,
} from "@/http/cache/reading-response";
import { PublishedBookService } from "@/services/published-book";
import { resolveContainedPath } from "@/storage/layout";
import { getRuntimeStorageLayout } from "@/storage/runtime";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params, request }) => {
  const bookKey = params.bookKey ?? "";
  const pageKey = params.pageKey ?? "";
  const { database, decision } = resolveRuntimeAdministrator(locals.session);
  const layout = await getRuntimeStorageLayout();
  const page = await new PublishedBookService(database, layout).resolvePage({
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
    pageIdentity: String(page.pageId),
    rendererVersion: page.rendererVersion,
    requestPath: new URL(request.url).pathname,
    versionId: page.versionId,
    visibility: page.visibility,
  });
  const notModified = conditionalNotModified(
    request,
    response.etag,
    response.headers,
  );
  if (notModified) return notModified;

  let html: string;
  try {
    html = await readFile(
      await resolveContainedPath(layout.root, page.pageRelativePath),
      "utf8",
    );
  } catch (cause) {
    throw new SafeApplicationError(
      "BOOK_UNAVAILABLE",
      "This book is temporarily unavailable.",
      503,
      { cause },
    );
  }
  return new Response(html, { headers: response.headers });
};
