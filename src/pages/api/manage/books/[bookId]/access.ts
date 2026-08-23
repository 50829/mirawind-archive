import type { APIRoute } from "astro";

import { createCatalogServer } from "@/composition/server/catalog";
import { getRuntimeEnvironment } from "@/composition/storage";
import { SafeApplicationError } from "@/domain/errors";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { readBoundedJson } from "@/http/json-body";
import { requireMutationOrigin } from "@/http/origin";

export const prerender = false;

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  const { database, session } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const bookId = Number(params.bookId);
  if (!Number.isSafeInteger(bookId) || bookId < 1) {
    throw new SafeApplicationError("NOT_FOUND", "The book was not found.", 404);
  }
  const body = await readBoundedJson(request, 64 * 1024);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !["private", "public"].includes(
      String((body as Record<string, unknown>).access),
    )
  ) {
    throw new SafeApplicationError(
      "REQUEST_BODY_INVALID",
      "Access must be private or public.",
      400,
    );
  }
  const access = String((body as Record<string, unknown>).access) as
    "private" | "public";
  createCatalogServer(database).setBookAccess({
    access,
    actorUserId: session?.user.id ?? null,
    bookId,
    nowMs: Date.now(),
  });
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json({ access, book_id: bookId }, { headers });
};
