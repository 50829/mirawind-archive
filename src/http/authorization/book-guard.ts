import type { AuthorizationDecision } from "@/http/authorization/admin-guard";

export type BookVisibility = "draft" | "private" | "public";
export type VersionState =
  "ready" | "published" | "superseded" | "failed" | "corrupt";

export type BookAccessDecision =
  | {
      readonly allowed: true;
      readonly audience: "administrator" | "anonymous";
    }
  | {
      readonly allowed: false;
      readonly cacheControl: "no-store";
      readonly representation: "hidden-or-missing";
      readonly status: 404;
    };

const hiddenOrMissing = Object.freeze({
  allowed: false,
  cacheControl: "no-store",
  representation: "hidden-or-missing",
  status: 404,
} as const);

export function authorizeBookResource(input: {
  readonly administrator: AuthorizationDecision;
  readonly exists: boolean;
  readonly versionState?: VersionState;
  readonly visibility?: BookVisibility;
}): BookAccessDecision {
  if (!input.exists || !input.visibility) return hiddenOrMissing;
  if (
    input.versionState &&
    !["published", "superseded"].includes(input.versionState)
  ) {
    return hiddenOrMissing;
  }
  if (input.administrator.allowed) {
    return { allowed: true, audience: "administrator" };
  }
  if (input.visibility === "public") {
    return { allowed: true, audience: "anonymous" };
  }
  return hiddenOrMissing;
}
