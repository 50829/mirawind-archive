import { SafeApplicationError } from "@/domain/errors";

type CacheKind =
  | "draft"
  | "hidden-or-missing"
  | "login"
  | "manage"
  | "private"
  | "private-api";

export function cachePolicyFor(kind: CacheKind): string {
  return kind === "hidden-or-missing" ? "no-store" : "private, no-store";
}

export function requireExactOrigin(
  requestOrigin: string | null,
  configuredOrigin: string,
): void {
  if (requestOrigin !== configuredOrigin) {
    throw new SafeApplicationError(
      "INVALID_ORIGIN",
      "The request origin is not allowed.",
      403,
    );
  }
}

export function createSafeJsonError(input: {
  readonly cause?: unknown;
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly status: number;
}): Response {
  void input.cause;
  return Response.json(
    {
      code: input.code,
      message: input.message,
      request_id: input.requestId,
    },
    {
      headers: { "Cache-Control": "private, no-store" },
      status: input.status,
    },
  );
}
