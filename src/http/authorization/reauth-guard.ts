import {
  authorizeSoleAdministrator,
  type AdministratorSession,
  type AuthorizationDecision,
} from "@/http/authorization/admin-guard";

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
