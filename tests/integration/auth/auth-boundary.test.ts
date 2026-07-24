import { describe, expect, it } from "vitest";

import {
  authorizeSoleAdministrator,
  validateFallbackPassword,
} from "@/http/authorization/admin-guard";

const now = 1_800_000_000_000;

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
});
