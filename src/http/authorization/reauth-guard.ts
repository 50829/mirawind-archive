import {
  authorizeSoleAdministrator,
  type AdministratorSession,
  type AuthorizationDecision,
} from "./admin-guard.js";

export function requireRecentAdministratorAuthentication(input: {
  readonly adminUserId: string;
  readonly nowMs: number;
  readonly session: AdministratorSession | null;
}): AuthorizationDecision {
  return authorizeSoleAdministrator({
    ...input,
    requireFresh: true,
  });
}
