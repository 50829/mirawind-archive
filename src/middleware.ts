import { defineMiddleware } from "astro:middleware";

import { resolveRequestSession } from "@/auth/session";
import {
  createSafeHtmlError,
  createSafeJsonError,
  safeErrorInputFromUnknown,
} from "@/http/errors/responses";
import { errorPolicyForRequest } from "@/http/errors/error-policy";
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
    const safe = safeErrorInputFromUnknown({
      cause,
      requestId: requestContext.id,
    });
    const input = {
      ...safe,
      policy: errorPolicyForRequest(requestPath, safe.status),
    };
    response =
      requestPath.startsWith("/api/") ||
      request.headers.get("accept")?.includes("application/json")
        ? createSafeJsonError(input)
        : createSafeHtmlError(input);
  }
  response.headers.set("X-Request-ID", requestContext.id);
  return response;
});
