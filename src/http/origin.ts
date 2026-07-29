import { SafeApplicationError } from "@/domain/errors";

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

export function requireMutationOrigin(
  request: Request,
  configuredOrigin: string,
): void {
  requireExactOrigin(request.headers.get("origin"), configuredOrigin);
}
