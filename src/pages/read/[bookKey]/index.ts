import type { APIRoute } from "astro";

import { createPublishedBookServer } from "@/composition/server";
import { resolveRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { getRuntimeStorageLayout } from "@/composition/storage";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params, request }) => {
  const bookKey = params.bookKey ?? "";
  const { database, decision } = resolveRuntimeAdministrator(locals.session);
  const layout = await getRuntimeStorageLayout();
  const first = await createPublishedBookServer(database, layout).resolvePage({
    administrator: decision,
    bookKey,
    pageKey: "1",
  });
  const location = new URL(
    `/read/${first.alias ?? String(first.bookId)}/${first.pageAlias ?? String(first.pageId)}`,
    request.url,
  );
  const headers = new Headers({ Location: location.toString() });
  applyResponsePolicy(headers, "redirect");
  return new Response(null, { headers, status: 302 });
};
