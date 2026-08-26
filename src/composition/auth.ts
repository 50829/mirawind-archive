import { join } from "node:path";

import type Database from "better-sqlite3";

import { parseEnvironment } from "@/config/environment";
import type { RequestSession } from "@/modules/identity/application/identity-api";
import { openDatabase } from "@/platform/sqlite/connection";
import { createHttpAuth } from "@/modules/identity/adapters/better-auth/http-auth";
import { createLocalDevelopmentSession } from "@/modules/identity/adapters/sqlite/local-development-session";

let runtime:
  | {
      readonly auth: ReturnType<typeof createHttpAuth>;
      readonly database: Database.Database;
      readonly environment: ReturnType<typeof parseEnvironment>;
    }
  | undefined;

function runtimeMode(): "development" | "production" | "test" {
  if (process.env.NODE_ENV === "test") return "test";
  if (process.env.NODE_ENV === "development") return "development";
  return "production";
}

export function getRuntimeAuth(): ReturnType<typeof createHttpAuth> {
  if (runtime) return runtime.auth;
  const environment = parseEnvironment(process.env, { mode: runtimeMode() });
  const database = openDatabase(
    join(environment.dataDirectory, "db", "mirawind.sqlite"),
    { role: "web" },
  );
  const auth = createHttpAuth({ database, environment });
  runtime = { auth, database, environment };
  return auth;
}

export function getRuntimeDatabase(): Database.Database {
  getRuntimeAuth();
  if (!runtime) throw new Error("AUTH_RUNTIME_NOT_INITIALIZED");
  return runtime.database;
}

export async function resolveRequestSession(
  request: Request,
): Promise<RequestSession | null> {
  getRuntimeAuth();
  if (!runtime) throw new Error("AUTH_RUNTIME_NOT_INITIALIZED");
  if (runtime.environment.localDevelopmentTrust) {
    return createLocalDevelopmentSession(runtime.database);
  }
  const cookie = request.headers.get("cookie");
  if (!cookie || !cookie.includes("better-auth")) return null;
  const result = await runtime.auth.api.getSession({
    headers: request.headers,
  });
  if (!result) return null;
  return {
    authenticatedAtMs: new Date(result.session.createdAt).getTime(),
    expiresAtMs: new Date(result.session.expiresAt).getTime(),
    sessionId: result.session.id,
    user: {
      email: result.user.email,
      id: result.user.id,
      name: result.user.name,
    },
  };
}

export function closeRuntimeAuthForTests(): void {
  runtime?.database.close();
  runtime = undefined;
}
