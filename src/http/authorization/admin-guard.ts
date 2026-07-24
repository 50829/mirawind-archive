export interface AdministratorSession {
  readonly authenticatedAtMs: number;
  readonly userId: string;
}

export type AuthorizationDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        "UNAUTHENTICATED" | "NOT_SOLE_ADMINISTRATOR" | "STALE_AUTHENTICATION";
    };

export function authorizeSoleAdministrator(input: {
  readonly adminUserId: string;
  readonly nowMs: number;
  readonly requireFresh: boolean;
  readonly session: AdministratorSession | null;
}): AuthorizationDecision {
  if (!input.session) return { allowed: false, reason: "UNAUTHENTICATED" };
  if (input.session.userId !== input.adminUserId) {
    return { allowed: false, reason: "NOT_SOLE_ADMINISTRATOR" };
  }
  if (
    input.requireFresh &&
    input.nowMs - input.session.authenticatedAtMs > 300_000
  ) {
    return { allowed: false, reason: "STALE_AUTHENTICATION" };
  }
  return { allowed: true };
}

export function validateFallbackPassword(password: string): {
  readonly valid: boolean;
} {
  const length = [...password].length;
  return { valid: length >= 16 && length <= 128 };
}
