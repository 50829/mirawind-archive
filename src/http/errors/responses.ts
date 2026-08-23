import { SafeApplicationError } from "@/domain/errors";
import {
  applyResponsePolicy,
  type ResponsePolicyKind,
} from "../cache/policies";
import { robotsMetaContent } from "../seo/robots";

export interface SafeErrorInput {
  readonly cause?: unknown;
  readonly code: string;
  readonly message: string;
  readonly policy?: ResponsePolicyKind;
  readonly requestId: string;
  readonly status: number;
}

export interface SafeErrorRepresentation {
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly status: number;
}

function safeRepresentation(input: SafeErrorInput): SafeErrorRepresentation {
  void input.cause;
  const code = /^[A-Z][A-Z0-9_]{2,79}$/.test(input.code)
    ? input.code
    : "INTERNAL_SERVER_ERROR";
  const status =
    Number.isSafeInteger(input.status) &&
    input.status >= 400 &&
    input.status <= 599
      ? input.status
      : 500;
  return {
    code,
    message: input.message.slice(0, 500),
    requestId: input.requestId,
    status,
  };
}

function errorHeaders(
  policy: ResponsePolicyKind,
  contentType: string,
  status: number,
): Headers {
  const headers = new Headers({
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(headers, policy);
  if (status === 503) headers.set("Retry-After", "30");
  return headers;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '"': "&quot;",
        "&": "&amp;",
        "'": "&#39;",
        "<": "&lt;",
        ">": "&gt;",
      })[character] ?? character,
  );
}

export function createSafeJsonError(input: SafeErrorInput): Response {
  const safe = safeRepresentation(input);
  return Response.json(
    {
      code: safe.code,
      message: safe.message,
      request_id: safe.requestId,
    },
    {
      headers: errorHeaders(
        input.policy ?? "private-api",
        "application/json; charset=utf-8",
        safe.status,
      ),
      status: safe.status,
    },
  );
}

export function createSafeHtmlError(input: SafeErrorInput): Response {
  const safe = safeRepresentation(input);
  const title = safe.status === 404 ? "Not found" : "Request failed";
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="robots" content="${robotsMetaContent(false)}">
    <meta name="viewport" content="width=device-width">
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(safe.message)}</p>
      <p>Request ID: <code>${escapeHtml(safe.requestId)}</code></p>
    </main>
  </body>
</html>`;
  return new Response(body, {
    headers: errorHeaders(
      input.policy ?? "hidden-or-missing",
      "text/html; charset=utf-8",
      safe.status,
    ),
    status: safe.status,
  });
}

export function safeErrorInputFromUnknown(input: {
  readonly cause: unknown;
  readonly policy?: ResponsePolicyKind;
  readonly requestId: string;
}): SafeErrorInput {
  if (input.cause instanceof SafeApplicationError) {
    return {
      cause: input.cause,
      code: input.cause.code,
      message: input.cause.message,
      ...(input.policy ? { policy: input.policy } : {}),
      requestId: input.requestId,
      status: input.cause.status,
    };
  }
  return {
    cause: input.cause,
    code: "INTERNAL_SERVER_ERROR",
    message: "The request could not be completed.",
    ...(input.policy ? { policy: input.policy } : {}),
    requestId: input.requestId,
    status: 500,
  };
}
