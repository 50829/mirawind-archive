import type { ResponsePolicyKind } from "../cache/policies.js";

export function errorPolicyForRequest(
  requestPath: string,
  status: number,
): ResponsePolicyKind {
  if (status === 404) return "hidden-or-missing";
  return requestPath.startsWith("/api/") ? "private-api" : "hidden-or-missing";
}
