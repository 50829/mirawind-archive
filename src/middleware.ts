import { defineMiddleware } from "astro:middleware";

import { resolveRequestSession } from "@/auth/session";
import {
  createSafeHtmlError,
  createSafeJsonError,
  safeErrorInputFromUnknown,
} from "@/http/errors/responses";
import { createRequestContext } from "@/http/request-context";

export const onRequest = defineMiddleware(async ({ locals, request }, next) => {
  const requestContext = createRequestContext(request);
  const requestPath = new URL(request.url).pathname;
  locals.requestContext = requestContext;
  let response: Response;
  try {
    locals.session = await resolveRequestSession(request);
    response = await next();
  } catch (cause) {
    const input = safeErrorInputFromUnknown({
      cause,
      policy: requestPath.startsWith("/api/")
        ? "private-api"
        : "hidden-or-missing",
      requestId: requestContext.id,
    });
    response =
      requestPath.startsWith("/api/") ||
      request.headers.get("accept")?.includes("application/json")
        ? createSafeJsonError(input)
        : createSafeHtmlError(input);
  }
  response.headers.set("X-Request-ID", requestContext.id);
  return response;
});
