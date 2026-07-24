import { describe, expect, it } from "vitest";

import {
  EnvironmentValidationError,
  parseEnvironment,
} from "@/config/environment";

const validEnvironment = {
  MIRAWIND_ALLOWED_HOSTS: "library.example.test",
  MIRAWIND_AUTH_SECRET: "correct-horse-battery-staple-32-bytes",
  MIRAWIND_DATA_DIR: "/srv/mirawind/data",
  MIRAWIND_PASSKEY_RP_ID: "library.example.test",
  MIRAWIND_PUBLIC_ORIGIN: "https://library.example.test",
};

describe("parseEnvironment", () => {
  it("accepts an exact HTTPS production origin and RP ID", () => {
    expect(
      parseEnvironment(validEnvironment, { mode: "production" }),
    ).toMatchObject({
      allowedHosts: ["library.example.test"],
      dataDirectory: "/srv/mirawind/data",
      passkeyRpId: "library.example.test",
      publicOrigin: "https://library.example.test",
    });
  });

  it("rejects production HTTP origins", () => {
    expect(() =>
      parseEnvironment(
        {
          ...validEnvironment,
          MIRAWIND_PUBLIC_ORIGIN: "http://library.example.test",
        },
        { mode: "production" },
      ),
    ).toThrow(EnvironmentValidationError);
  });

  it("allows HTTP only for an exact localhost development origin", () => {
    expect(
      parseEnvironment(
        {
          ...validEnvironment,
          MIRAWIND_ALLOWED_HOSTS: "127.0.0.1",
          MIRAWIND_PASSKEY_RP_ID: "127.0.0.1",
          MIRAWIND_PUBLIC_ORIGIN: "http://127.0.0.1:4321",
        },
        { mode: "development" },
      ).publicOrigin,
    ).toBe("http://127.0.0.1:4321");
  });

  it.each([
    ["relative data root", { MIRAWIND_DATA_DIR: "./data" }],
    [
      "origin with credentials",
      { MIRAWIND_PUBLIC_ORIGIN: "https://x:y@library.example.test" },
    ],
    [
      "origin with path",
      { MIRAWIND_PUBLIC_ORIGIN: "https://library.example.test/path" },
    ],
    ["mismatched RP ID", { MIRAWIND_PASSKEY_RP_ID: "other.example.test" }],
    ["short secret", { MIRAWIND_AUTH_SECRET: "too-short" }],
    ["low-entropy secret", { MIRAWIND_AUTH_SECRET: "a".repeat(64) }],
  ])("rejects %s", (_name, override) => {
    expect(() =>
      parseEnvironment(
        { ...validEnvironment, ...override },
        { mode: "production" },
      ),
    ).toThrow(EnvironmentValidationError);
  });
});
