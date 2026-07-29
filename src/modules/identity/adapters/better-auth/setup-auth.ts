import { betterAuth } from "better-auth";

import { type AuthFactoryInput } from "@/modules/identity/adapters/better-auth/http-auth";

export function createSetupAuth(input: AuthFactoryInput) {
  return betterAuth({
    basePath: "/api/auth",
    baseURL: input.environment.publicOrigin,
    database: input.database,
    emailAndPassword: {
      disableSignUp: false,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 16,
    },
    rateLimit: {
      enabled: false,
      storage: "database",
    },
    secret: input.environment.authSecret,
    session: {
      freshAge: 300,
    },
    trustedOrigins: [input.environment.publicOrigin],
  });
}
