import { join } from "node:path";

import type Database from "better-sqlite3";

import { parseEnvironment } from "@/config/environment";
import type { RequestSession } from "@/modules/identity/application/public";
import { openDatabase } from "@/platform/sqlite/connection";
import { createHttpAuth } from "@/modules/identity/adapters/better-auth/http-auth";

let runtime:
  | {
      readonly auth: ReturnType<typeof createHttpAuth>;
      readonly database: Database.Database;
    }
  | undefined;

function runtimeMode(): "development" | "production" | "test" {
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "test") return "test";
  return "development";
}

export function getRuntimeAuth(): ReturnType<typeof createHttpAuth> {
  if (runtime) return runtime.auth;
  const environment = parseEnvironment(process.env, { mode: runtimeMode() });
  const database = openDatabase(
    join(environment.dataDirectory, "db", "mirawind.sqlite"),
    { role: "web" },
  );
  const auth = createHttpAuth({ database, environment });
  runtime = { auth, database };
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
  const cookie = request.headers.get("cookie");
  if (!cookie || !cookie.includes("better-auth")) return null;
  const result = await getRuntimeAuth().api.getSession({
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
