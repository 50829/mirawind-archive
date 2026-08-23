import type { APIRoute } from "astro";

import { createCatalogServer } from "@/composition/server/catalog";
import { SafeApplicationError } from "@/domain/errors";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { readBoundedJson } from "@/http/json-body";
import { requireMutationOrigin } from "@/http/origin";
import { getRuntimeEnvironment } from "@/composition/storage";

export const prerender = false;

function requireBookId(value: string | undefined): number {
  if (!value || !/^[1-9][0-9]*$/u.test(value)) {
    throw new SafeApplicationError("NOT_FOUND", "The book was not found.", 404);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new SafeApplicationError("NOT_FOUND", "The book was not found.", 404);
  }
  return parsed;
}

function requireHeader(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (!value) {
    throw new SafeApplicationError(
      name === "if-match"
        ? "DELETION_CONFIRMATION_STALE"
        : "IDEMPOTENCY_KEY_INVALID",
      name === "if-match"
        ? "The deletion confirmation is stale."
        : "A valid Idempotency-Key header is required.",
      name === "if-match" ? 412 : 400,
    );
  }
  return value;
}

export const DELETE: APIRoute = async ({ locals, params, request }) => {
  const { database, session } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const body = await readBoundedJson(request, 8 * 1024);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    typeof (body as Record<string, unknown>).confirmationTitle !== "string"
  ) {
    throw new SafeApplicationError(
      "REQUEST_BODY_INVALID",
      "The deletion confirmation is invalid.",
      400,
    );
  }
  const actorUserId = session?.user.id;
  if (!actorUserId) {
    throw new SafeApplicationError(
      "UNAUTHENTICATED",
      "Authentication is required.",
      401,
    );
  }
  const accepted = createCatalogServer(database).acceptBookDeletion({
    actorUserId,
    bookId: requireBookId(params.bookId),
    confirmationTitle: String(
      (body as Record<string, unknown>).confirmationTitle,
    ),
    idempotencyKey: requireHeader(request, "idempotency-key"),
    mutationToken: requireHeader(request, "if-match"),
    nowMs: Date.now(),
  });
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(headers, "private-api");
  return Response.json(accepted, { headers, status: 202 });
};
