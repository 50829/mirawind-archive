import { PassThrough } from "node:stream";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { createSetupAuth } from "@/auth/setup-server";
import { runAdminCli, type AdminCliDependencies } from "@/cli/admin-cli";
import { bootstrapAdministrator } from "@/cli/commands/admin-bootstrap";
import { recoverAdministrator } from "@/cli/commands/admin-recover";
import { applyMigrations } from "@/db/migrate";
import { loadMigrationManifest } from "@/db/migration-manifest";

const environment = {
  allowedHosts: ["library.example.test"],
  authSecret: "correct-horse-battery-staple-32-bytes",
  dataDirectory: "/srv/mirawind/data",
  passkeyRpId: "library.example.test",
  publicOrigin: "https://library.example.test",
} as const;

function dependencies(): AdminCliDependencies {
  return {
    bootstrap: vi.fn(async () => undefined),
    recover: vi.fn(async () => undefined),
    serviceIsRunning: vi.fn(async () => false),
  };
}

describe("offline administrator CLI", () => {
  it("refuses secrets from a non-interactive stream", async () => {
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    const output = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = false;
    output.isTTY = false;

    await expect(
      runAdminCli(["admin", "bootstrap", "--data-dir", "/srv/mirawind"], {
        ...dependencies(),
        input,
        output,
      }),
    ).resolves.toBe(2);
  });

  it("rejects passwords outside 16–128 characters before any mutation", async () => {
    const deps = dependencies();
    await expect(
      runAdminCli(["admin", "bootstrap", "--data-dir", "/srv/mirawind"], {
        ...deps,
        input: { isTTY: true } as NodeJS.ReadStream,
        output: { isTTY: true } as NodeJS.WriteStream,
        prompt: vi.fn(async () => ({
          displayName: "Admin",
          email: "admin@example.test",
          password: "short",
        })),
      }),
    ).resolves.toBe(4);
    expect(deps.bootstrap).not.toHaveBeenCalled();
  });

  it("blocks bootstrap and recovery while a service owns the data root", async () => {
    const deps = dependencies();
    deps.serviceIsRunning = vi.fn(async () => true);
    await expect(
      runAdminCli(["admin", "recover", "--data-dir", "/srv/mirawind"], {
        ...deps,
        input: { isTTY: true } as NodeJS.ReadStream,
        output: { isTTY: true } as NodeJS.WriteStream,
      }),
    ).resolves.toBe(3);
    expect(deps.recover).not.toHaveBeenCalled();
  });

  it("bootstraps once and fully recovers credentials through Better Auth", async () => {
    const database = new Database(":memory:");
    applyMigrations(database, await loadMigrationManifest());
    const auth = createSetupAuth({ database, environment });
    const password = "initial-fallback-password-123";
    const bootstrap = await bootstrapAdministrator({
      auth,
      database,
      displayName: "Administrator",
      email: "admin@example.test",
      nowMs: 1_000,
      password,
    });
    expect(
      database
        .prepare("SELECT admin_user_id FROM installation WHERE id = 1")
        .get(),
    ).toEqual({ admin_user_id: bootstrap.userId });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM session").get(),
    ).toEqual({ count: 0 });
    await expect(
      bootstrapAdministrator({
        auth,
        database,
        displayName: "Second",
        email: "second@example.test",
        nowMs: 2_000,
        password,
      }),
    ).rejects.toThrow("ADMIN_ALREADY_INITIALIZED");

    database
      .prepare(
        `INSERT INTO session
          (id, expiresAt, token, createdAt, updatedAt, userId)
         VALUES ('session-old', ?, 'token-old', ?, ?, ?)`,
      )
      .run(99_999, 2_000, 2_000, bootstrap.userId);
    database
      .prepare(
        `INSERT INTO passkey
          (id, publicKey, userId, credentialID, counter, deviceType, backedUp)
         VALUES ('passkey-old', 'public-key', ?, 'credential-old', 0, 'singleDevice', 0)`,
      )
      .run(bootstrap.userId);

    const recoveredPassword = "recovered-fallback-password-456";
    expect(
      await recoverAdministrator({
        auth,
        database,
        nowMs: 3_000,
        password: recoveredPassword,
      }),
    ).toMatchObject({
      deletedPasskeys: 1,
      revokedSessions: 1,
      userId: bootstrap.userId,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM passkey").get(),
    ).toEqual({ count: 0 });
    await expect(
      auth.api.signInEmail({
        body: {
          email: "admin@example.test",
          password: recoveredPassword,
        },
      }),
    ).resolves.toMatchObject({
      user: { id: bootstrap.userId },
    });
    expect(
      database.prepare("SELECT action FROM audit_events ORDER BY id").all(),
    ).toEqual([{ action: "admin.bootstrap" }, { action: "admin.recover" }]);
    database.close();
  });
});
