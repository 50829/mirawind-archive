export type PasskeyMutationDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        | "FINAL_PASSKEY_REQUIRES_PASSWORD"
        | "NOT_SOLE_ADMINISTRATOR"
        | "PASSKEY_LIMIT_REACHED"
        | "SESSION_NOT_FRESH"
        | "UNAUTHENTICATED";
    };

export function authorizePasskeyMutation(input: {
  readonly adminUserId: string | null;
  readonly authenticatedAtMs: number | null;
  readonly nowMs: number;
  readonly passkeyCount: number;
  readonly path: string;
  readonly userId: string | null;
}): PasskeyMutationDecision {
  if (!input.userId || input.authenticatedAtMs === null) {
    return { allowed: false, reason: "UNAUTHENTICATED" };
  }
  if (!input.adminUserId || input.userId !== input.adminUserId) {
    return { allowed: false, reason: "NOT_SOLE_ADMINISTRATOR" };
  }
  if (input.nowMs - input.authenticatedAtMs > 300_000) {
    return { allowed: false, reason: "SESSION_NOT_FRESH" };
  }
  if (
    (input.path === "/passkey/generate-register-options" ||
      input.path === "/passkey/verify-registration") &&
    input.passkeyCount >= 10
  ) {
    return { allowed: false, reason: "PASSKEY_LIMIT_REACHED" };
  }
  if (input.path === "/passkey/delete-passkey" && input.passkeyCount <= 1) {
    return { allowed: false, reason: "FINAL_PASSKEY_REQUIRES_PASSWORD" };
  }
  return { allowed: true };
}
