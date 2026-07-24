import type { RequestSession } from "../../auth/session.js";
import { getRuntimeDatabase } from "../../auth/session.js";
import { InstallationRepository } from "../../db/repositories/installation.js";
import { SafeApplicationError } from "../../domain/errors.js";
import { authorizeSoleAdministrator } from "./admin-guard.js";

export function resolveRuntimeAdministrator(
  session: RequestSession | null,
): Readonly<{
  database: ReturnType<typeof getRuntimeDatabase>;
  decision: ReturnType<typeof authorizeSoleAdministrator>;
}> {
  const database = getRuntimeDatabase();
  const adminUserId = new InstallationRepository(database).adminUserId();
  const decision =
    adminUserId === null
      ? ({ allowed: false, reason: "NOT_SOLE_ADMINISTRATOR" } as const)
      : authorizeSoleAdministrator({
          adminUserId,
          nowMs: Date.now(),
          requireFresh: false,
          session: session
            ? {
                authenticatedAtMs: session.authenticatedAtMs,
                userId: session.user.id,
              }
            : null,
        });
  return Object.freeze({ database, decision });
}

export function requireRuntimeAdministrator(
  session: RequestSession | null,
  options: { readonly hideExistence?: boolean } = {},
) {
  const { database, decision } = resolveRuntimeAdministrator(session);
  if (!decision.allowed) {
    if (options.hideExistence) {
      throw new SafeApplicationError(
        "NOT_FOUND",
        "The requested resource was not found.",
        404,
      );
    }
    throw new SafeApplicationError(
      decision.reason,
      decision.reason === "UNAUTHENTICATED"
        ? "Authentication is required."
        : "Administrator authorization is required.",
      decision.reason === "UNAUTHENTICATED" ? 401 : 403,
    );
  }
  return Object.freeze({ database, session });
}
