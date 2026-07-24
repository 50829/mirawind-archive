import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import type Database from "better-sqlite3";

import type { EnvironmentConfig } from "../config/environment.js";

export interface AuthFactoryInput {
  readonly database: Database.Database;
  readonly environment: EnvironmentConfig;
}

function sharedOptions(input: AuthFactoryInput) {
  return {
    basePath: "/api/auth",
    baseURL: input.environment.publicOrigin,
    database: input.database,
    plugins: [
      passkey({
        origin: input.environment.publicOrigin,
        rpID: input.environment.passkeyRpId,
        rpName: "Mirawind Library",
      }),
    ],
    secret: input.environment.authSecret,
    session: {
      freshAge: 300,
    },
    trustedOrigins: [input.environment.publicOrigin],
  };
}

export function createHttpAuth(input: AuthFactoryInput) {
  return betterAuth({
    ...sharedOptions(input),
    emailAndPassword: {
      disableSignUp: true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 16,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
    },
  });
}
