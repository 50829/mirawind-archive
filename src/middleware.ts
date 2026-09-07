import { defineMiddleware } from "astro:middleware";

import { resolveRequestSession } from "@/composition/auth";
import { getRuntimeEnvironment } from "@/composition/storage";
import { localDevelopmentSessionId } from "@/modules/identity/application/identity-api";
import {
  createSafeHtmlError,
  createSafeJsonError,
  safeErrorInputFromUnknown,
} from "@/http/errors/responses";
import { errorPolicyForRequest } from "@/http/errors/error-policy";
import { createRequestContext } from "@/http/request-context";
import { operationalMetrics } from "@/observability/metrics";
import { applyResponsePolicy } from "@/http/cache/policies";

function isReaderAsset(path: string): boolean {
  return path.startsWith("/reader-assets/");
}

export const onRequest = defineMiddleware(async ({ locals, request }, next) => {
  const requestContext = createRequestContext(request);
  const requestPath = new URL(request.url).pathname;
  locals.requestContext = requestContext;
  let response: Response;
  try {
    locals.session = await resolveRequestSession(request);
    if (
      locals.session?.sessionId === localDevelopmentSessionId &&
      ["GET", "HEAD"].includes(request.method) &&
      !requestPath.startsWith("/api/") &&
      request.headers.get("accept")?.includes("text/html")
    ) {
      const requested = new URL(request.url);
      const origin = getRuntimeEnvironment().publicOrigin;
      if (requested.origin !== origin) {
        const headers = new Headers({
          Location: `${origin}${requested.pathname}${requested.search}`,
          "X-Request-ID": requestContext.id,
        });
        applyResponsePolicy(headers, "manage");
        return new Response(null, { status: 303, headers });
      }
    }
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
  const elapsedMs = Date.now() - requestContext.startedAtMs;
  if (requestPath.startsWith("/read/")) {
    operationalMetrics.recordRequest("read", elapsedMs);
  } else if (requestPath.includes("/search")) {
    operationalMetrics.recordRequest("search", elapsedMs);
  }
  response.headers.set("X-Request-ID", requestContext.id);
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    isReaderAsset(requestPath)
  ) {
    applyResponsePolicy(response.headers, "site-static");
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    response.headers.set("X-Content-Type-Options", "nosniff");
  }
  return response;
});
