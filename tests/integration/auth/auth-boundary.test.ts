import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createHttpAuth } from "@/modules/identity/adapters/better-auth/http-auth";
import { createSetupAuth } from "@/modules/identity/adapters/better-auth/setup-auth";
import { applyMigrations } from "@/platform/sqlite/migrate";
import { loadMigrationManifest } from "@/platform/sqlite/migration-manifest";
import {
  authorizeSoleAdministrator,
  validateFallbackPassword,
} from "@/http/authorization/admin-guard";
import { authorizeBookResource } from "@/http/authorization/book-guard";
import { requireRecentAdministratorAuthentication } from "@/http/authorization/reauth-guard";

const now = 1_800_000_000_000;
const environment = {
  allowedHosts: ["library.example.test"],
  authSecret: "correct-horse-battery-staple-32-bytes",
  dataDirectory: "/srv/mirawind/data",
  passkeyRpId: "library.example.test",
  publicOrigin: "https://library.example.test",
} as const;

describe("sole-administrator authorization", () => {
  it("accepts the registered administrator with a 299-second-old authentication", () => {
    expect(
      authorizeSoleAdministrator({
        adminUserId: "admin",
        nowMs: now,
        requireFresh: true,
        session: { authenticatedAtMs: now - 299_000, userId: "admin" },
      }),
    ).toEqual({ allowed: true });
  });

  it("accepts the exact 300-second boundary and rejects 301 seconds", () => {
    expect(
      authorizeSoleAdministrator({
        adminUserId: "admin",
        nowMs: now,
        requireFresh: true,
        session: { authenticatedAtMs: now - 300_000, userId: "admin" },
      }),
    ).toEqual({ allowed: true });
    expect(
      authorizeSoleAdministrator({
        adminUserId: "admin",
        nowMs: now,
        requireFresh: true,
        session: { authenticatedAtMs: now - 301_000, userId: "admin" },
      }),
    ).toEqual({ allowed: false, reason: "STALE_AUTHENTICATION" });
  });

  it("distinguishes missing authentication from a non-administrator session", () => {
    expect(
      authorizeSoleAdministrator({
        adminUserId: "admin",
        nowMs: now,
        requireFresh: false,
        session: null,
      }),
    ).toEqual({ allowed: false, reason: "UNAUTHENTICATED" });
    expect(
      authorizeSoleAdministrator({
        adminUserId: "admin",
        nowMs: now,
        requireFresh: false,
        session: { authenticatedAtMs: now, userId: "other" },
      }),
    ).toEqual({ allowed: false, reason: "NOT_SOLE_ADMINISTRATOR" });
  });

  it.each([
    ["x".repeat(15), false],
    ["x".repeat(16), true],
    ["密".repeat(128), true],
    ["x".repeat(129), false],
  ])("applies the 16–128 character password boundary", (password, valid) => {
    expect(validateFallbackPassword(password).valid).toBe(valid);
  });

  it("freezes the HTTP and setup-only Better Auth boundaries", async () => {
    const database = new Database(":memory:");
    applyMigrations(database, await loadMigrationManifest());
    const httpContext = await createHttpAuth({
      database,
      environment,
    }).$context;
    expect(httpContext.options).toMatchObject({
      advanced: {
        ipAddress: {
          ipAddressHeaders: ["x-real-ip"],
        },
      },
      baseURL: "https://library.example.test",
      emailAndPassword: {
        disableSignUp: true,
        enabled: true,
        maxPasswordLength: 128,
        minPasswordLength: 16,
      },
      rateLimit: { enabled: true, storage: "database" },
      session: { freshAge: 300 },
      trustedOrigins: ["https://library.example.test"],
    });

    const setupContext = await createSetupAuth({
      database,
      environment,
    }).$context;
    expect(setupContext.options.emailAndPassword).toMatchObject({
      disableSignUp: false,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 16,
    });
    database.close();
  });

  it("makes anonymous private and missing resources indistinguishable", () => {
    const administrator = {
      allowed: false,
      reason: "UNAUTHENTICATED",
    } as const;
    const hidden = authorizeBookResource({
      administrator,
      exists: true,
      visibility: "private",
    });
    const missing = authorizeBookResource({
      administrator,
      exists: false,
    });
    expect(hidden).toEqual(missing);
    expect(hidden).toEqual({
      allowed: false,
      cacheControl: "no-store",
      representation: "hidden-or-missing",
      status: 404,
    });
  });

  it("never exposes ready, failed, or corrupt versions by their file existence", () => {
    const administrator = { allowed: true } as const;
    for (const versionState of ["ready", "failed", "corrupt"] as const) {
      expect(
        authorizeBookResource({
          administrator,
          exists: true,
          versionState,
          visibility: "public",
        }).allowed,
      ).toBe(false);
    }
  });

  it("reuses the server-timed 300-second boundary for sensitive actions", () => {
    expect(
      requireRecentAdministratorAuthentication({
        adminUserId: "admin",
        nowMs: now,
        session: { authenticatedAtMs: now - 300_000, userId: "admin" },
      }),
    ).toEqual({ allowed: true });
  });
});
