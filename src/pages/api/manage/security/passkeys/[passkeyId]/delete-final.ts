import type { APIRoute } from "astro";

import { getRuntimeAuth, getRuntimeDatabase } from "@/auth/session";
import { parseEnvironment } from "@/config/environment";
import { InstallationRepository } from "@/db/repositories/installation";
import { validateFallbackPassword } from "@/http/authorization/admin-guard";
import { requireRecentAdministratorAuthentication } from "@/http/authorization/reauth-guard";
import {
  cachePolicyFor,
  createSafeJsonError,
  requireExactOrigin,
} from "@/http/response-policy";
import { deleteFinalPasskey } from "@/services/security/final-passkey";

export const prerender = false;

function errorResponse(
  request: Request,
  code: string,
  message: string,
  status: number,
  cause?: unknown,
): Response {
  return createSafeJsonError({
    cause,
    code,
    message,
    requestId: request.headers.get("x-request-id") ?? "unavailable",
    status,
  });
}

export const POST: APIRoute = async ({ locals, params, request }) => {
  const session = locals.session;
  if (!session) {
    return errorResponse(
      request,
      "UNAUTHENTICATED",
      "Authentication is required.",
      401,
    );
  }

  const database = getRuntimeDatabase();
  const adminUserId = new InstallationRepository(database).adminUserId();
  const authorization =
    adminUserId === null
      ? { allowed: false as const, reason: "NOT_SOLE_ADMINISTRATOR" as const }
      : requireRecentAdministratorAuthentication({
          adminUserId,
          nowMs: Date.now(),
          session: {
            authenticatedAtMs: session.authenticatedAtMs,
            userId: session.user.id,
          },
        });
  if (!authorization.allowed) {
    const status = authorization.reason === "STALE_AUTHENTICATION" ? 403 : 401;
    return errorResponse(
      request,
      authorization.reason,
      status === 403
        ? "Recent authentication is required."
        : "Administrator authentication is required.",
      status,
    );
  }

  const environment = parseEnvironment(process.env, {
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
  });
  try {
    requireExactOrigin(request.headers.get("origin"), environment.publicOrigin);
  } catch (error) {
    return errorResponse(
      request,
      "INVALID_ORIGIN",
      "The request origin is not allowed.",
      403,
      error,
    );
  }

  let password: string;
  try {
    const body = (await request.json()) as { current_password?: unknown };
    password =
      typeof body.current_password === "string" ? body.current_password : "";
  } catch (error) {
    return errorResponse(
      request,
      "INVALID_BODY",
      "A JSON request body is required.",
      400,
      error,
    );
  }
  if (!validateFallbackPassword(password).valid) {
    return errorResponse(
      request,
      "INVALID_PASSWORD",
      "The fallback password is invalid.",
      403,
    );
  }

  const auth = getRuntimeAuth();
  try {
    await auth.api.verifyPassword({
      body: { password },
      headers: request.headers,
    });
  } catch (error) {
    return errorResponse(
      request,
      "INVALID_PASSWORD",
      "The fallback password is invalid.",
      403,
      error,
    );
  }

  const passkeyId = params.passkeyId;
  if (!passkeyId) {
    return errorResponse(
      request,
      "PASSKEY_NOT_FOUND",
      "The Passkey was not found.",
      404,
    );
  }
  try {
    const result = await deleteFinalPasskey({
      auth,
      database,
      nowMs: Date.now(),
      passkeyId,
      userId: session.user.id,
    });
    if (!result.deleted) {
      return errorResponse(
        request,
        result.reason,
        result.reason === "NOT_FOUND"
          ? "The Passkey was not found."
          : "The Passkey set changed; refresh and try again.",
        result.reason === "NOT_FOUND" ? 404 : 409,
      );
    }
    return new Response(null, {
      headers: { "Cache-Control": cachePolicyFor("private-api") },
      status: 204,
    });
  } catch (error) {
    return errorResponse(
      request,
      "PASSKEY_DELETE_FAILED",
      "The Passkey could not be deleted.",
      500,
      error,
    );
  }
};
