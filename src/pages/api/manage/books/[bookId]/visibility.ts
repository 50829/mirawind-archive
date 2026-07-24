import type { APIRoute } from "astro";

import { SafeApplicationError } from "@/domain/errors";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { readBoundedJson } from "@/http/json-body";
import { requireMutationOrigin } from "@/http/origin";
import { makeBookNonPublic } from "@/services/publication";
import { getRuntimeEnvironment } from "@/storage/runtime";

export const prerender = false;

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  const { database, session } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const id = Number(params.bookId);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new SafeApplicationError("NOT_FOUND", "The book was not found.", 404);
  }
  const body = await readBoundedJson(request, 64 * 1024);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !["draft", "private"].includes(
      String((body as Record<string, unknown>).visibility),
    )
  ) {
    throw new SafeApplicationError(
      "REQUEST_BODY_INVALID",
      "Visibility must be draft or private.",
      400,
    );
  }
  const visibility = String((body as Record<string, unknown>).visibility) as
    "draft" | "private";
  makeBookNonPublic({
    actorUserId: session?.user.id ?? null,
    bookId: id,
    database,
    nowMs: Date.now(),
    visibility,
  });
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json({ book_id: id, visibility }, { headers });
};
