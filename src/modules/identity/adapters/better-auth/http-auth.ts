import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import type Database from "better-sqlite3";

import type { EnvironmentConfig } from "@/config/environment";
import {
  createPasskeyPolicyHooks,
  recordPasskeyUse,
} from "@/modules/identity/adapters/sqlite/passkey-policy";

export interface AuthFactoryInput {
  readonly database: Database.Database;
  readonly environment: EnvironmentConfig;
}

function sharedOptions(input: AuthFactoryInput) {
  return {
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-real-ip"],
      },
    },
    basePath: "/api/auth",
    baseURL: input.environment.publicOrigin,
    database: input.database,
    plugins: [
      passkey({
        authentication: {
          afterVerification({ verification }) {
            recordPasskeyUse({
              credentialId: verification.authenticationInfo.credentialID,
              database: input.database,
              nowMs: Date.now(),
            });
          },
        },
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
    disabledPaths: [
      "/request-password-reset",
      "/reset-password",
      "/sign-up/email",
    ],
    emailAndPassword: {
      disableSignUp: true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 16,
    },
    hooks: createPasskeyPolicyHooks(input.database),
    rateLimit: {
      enabled: true,
      storage: "database",
    },
  });
}
