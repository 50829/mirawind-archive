import { describe, expect, it } from "vitest";

import { authorizePasskeyMutation } from "@/modules/identity/application/identity-api";

const nowMs = 1_800_000_000_000;

function decision(
  overrides: Partial<Parameters<typeof authorizePasskeyMutation>[0]> = {},
) {
  return authorizePasskeyMutation({
    adminUserId: "admin",
    authenticatedAtMs: nowMs,
    nowMs,
    passkeyCount: 2,
    path: "/passkey/update-passkey",
    userId: "admin",
    ...overrides,
  });
}

describe("Passkey mutation policy", () => {
  it("accepts the 300-second freshness boundary and rejects 301 seconds", () => {
    expect(decision({ authenticatedAtMs: nowMs - 300_000 })).toEqual({
      allowed: true,
    });
    expect(decision({ authenticatedAtMs: nowMs - 301_000 })).toEqual({
      allowed: false,
      reason: "SESSION_NOT_FRESH",
    });
  });

  it("rejects non-administrator and anonymous mutations", () => {
    expect(decision({ userId: null })).toEqual({
      allowed: false,
      reason: "UNAUTHENTICATED",
    });
    expect(decision({ userId: "other" })).toEqual({
      allowed: false,
      reason: "NOT_SOLE_ADMINISTRATOR",
    });
  });

  it("enforces the ten-Passkey ceiling at both registration steps", () => {
    for (const path of [
      "/passkey/generate-register-options",
      "/passkey/verify-registration",
    ]) {
      expect(decision({ passkeyCount: 10, path })).toEqual({
        allowed: false,
        reason: "PASSKEY_LIMIT_REACHED",
      });
    }
  });

  it("routes final-key deletion through the password-verified action", () => {
    expect(
      decision({
        passkeyCount: 1,
        path: "/passkey/delete-passkey",
      }),
    ).toEqual({
      allowed: false,
      reason: "FINAL_PASSKEY_REQUIRES_PASSWORD",
    });
    expect(
      decision({
        passkeyCount: 2,
        path: "/passkey/delete-passkey",
      }),
    ).toEqual({ allowed: true });
  });
});
