import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

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
  it("resolves local data paths with the shared parser and preserves the configured secret", () => {
    const environment = parseEnvironment(
      {
        ...validEnvironment,
        MIRAWIND_DATA_DIR: "./data/development",
      },
      { mode: "development" },
    );
    expect(environment.dataDirectory).toBe(resolve("data/development"));
    expect(environment.authSecret).toBe(validEnvironment.MIRAWIND_AUTH_SECRET);
  });

  it("accepts an exact HTTPS production origin and RP ID", () => {
    expect(
      parseEnvironment(validEnvironment, { mode: "production" }),
    ).toMatchObject({
      allowedHosts: ["library.example.test"],
      dataDirectory: "/srv/mirawind/data",
      localDevelopmentTrust: false,
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

  it("allows localhost HTTP without inferring local trust", () => {
    expect(
      parseEnvironment(
        {
          ...validEnvironment,
          MIRAWIND_ALLOWED_HOSTS: "127.0.0.1",
          MIRAWIND_PASSKEY_RP_ID: "127.0.0.1",
          MIRAWIND_PUBLIC_ORIGIN: "http://127.0.0.1:4321",
        },
        { mode: "development" },
      ),
    ).toMatchObject({
      localDevelopmentTrust: false,
      publicOrigin: "http://127.0.0.1:4321",
    });
  });

  it("enables explicit local trust for a loopback-only Docker development boundary", () => {
    expect(
      parseEnvironment(
        {
          ...validEnvironment,
          HOST: "0.0.0.0",
          MIRAWIND_ALLOWED_HOSTS: "127.0.0.1,localhost",
          MIRAWIND_LOCAL_DEVELOPMENT_TRUST: "1",
          MIRAWIND_PASSKEY_RP_ID: "127.0.0.1",
          MIRAWIND_PUBLIC_ORIGIN: "http://127.0.0.1:4321",
        },
        { mode: "development" },
      ),
    ).toMatchObject({
      localDevelopmentTrust: true,
      publicOrigin: "http://127.0.0.1:4321",
    });
  });

  it("never enables local trust in test or production mode", () => {
    const local = {
      ...validEnvironment,
      HOST: "127.0.0.1",
      MIRAWIND_ALLOWED_HOSTS: "127.0.0.1,localhost",
      MIRAWIND_LOCAL_DEVELOPMENT_TRUST: "1",
      MIRAWIND_PASSKEY_RP_ID: "127.0.0.1",
      MIRAWIND_PUBLIC_ORIGIN: "https://127.0.0.1:4321",
    };
    expect(
      parseEnvironment(local, { mode: "test" }).localDevelopmentTrust,
    ).toBe(false);
    expect(
      parseEnvironment(local, { mode: "production" }).localDevelopmentTrust,
    ).toBe(false);
  });

  it("closes explicit development trust when an allowed host is not loopback", () => {
    const local = {
      ...validEnvironment,
      MIRAWIND_LOCAL_DEVELOPMENT_TRUST: "1",
      MIRAWIND_PASSKEY_RP_ID: "127.0.0.1",
      MIRAWIND_PUBLIC_ORIGIN: "http://127.0.0.1:4321",
    };
    expect(
      parseEnvironment(
        {
          ...local,
          MIRAWIND_ALLOWED_HOSTS: "127.0.0.1,library.example.test",
        },
        { mode: "development" },
      ).localDevelopmentTrust,
    ).toBe(false);
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
