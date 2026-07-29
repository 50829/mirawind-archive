import { PassThrough } from "node:stream";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { createHttpAuth } from "@/modules/identity/adapters/better-auth/http-auth";
import { createSetupAuth } from "@/modules/identity/adapters/better-auth/setup-auth";
import {
  deleteNonFinalPasskey,
  recordPasskeyUse,
} from "@/modules/identity/adapters/sqlite/passkey-policy";
import {
  runAdminCli,
  type AdminCliDependencies,
} from "@/entrypoints/cli/admin-cli";
import {
  bootstrapAdministrator,
  recoverAdministrator,
} from "@/composition/cli";
import { applyMigrations } from "@/platform/sqlite/migrate";
import { loadMigrationManifest } from "@/platform/sqlite/migration-manifest";
import { deleteFinalPasskey } from "@/modules/identity/adapters/sqlite/final-passkey";

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

  it("atomically deletes only the final owned Passkey and records a safe audit", async () => {
    const database = new Database(":memory:");
    applyMigrations(database, await loadMigrationManifest());
    const setupAuth = createSetupAuth({ database, environment });
    const bootstrap = await bootstrapAdministrator({
      auth: setupAuth,
      database,
      displayName: "Administrator",
      email: "admin@example.test",
      nowMs: 1_000,
      password: "initial-fallback-password-123",
    });
    database
      .prepare(
        `INSERT INTO passkey
          (id, publicKey, userId, credentialID, counter, deviceType, backedUp)
         VALUES ('final-key', 'public-key', ?, 'credential-final', 0, 'singleDevice', 0)`,
      )
      .run(bootstrap.userId);

    await expect(
      deleteFinalPasskey({
        auth: createHttpAuth({ database, environment }),
        database,
        nowMs: 2_000,
        passkeyId: "final-key",
        userId: bootstrap.userId,
      }),
    ).resolves.toEqual({ deleted: true });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM passkey").get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          "SELECT action, actor_user_id FROM audit_events ORDER BY id DESC LIMIT 1",
        )
        .get(),
    ).toEqual({
      action: "passkey.delete-final",
      actor_user_id: bootstrap.userId,
    });
    database.close();
  });

  it("keeps generic deletion from removing the final Passkey", async () => {
    const database = new Database(":memory:");
    applyMigrations(database, await loadMigrationManifest());
    const bootstrap = await bootstrapAdministrator({
      auth: createSetupAuth({ database, environment }),
      database,
      displayName: "Administrator",
      email: "admin@example.test",
      nowMs: 1_000,
      password: "initial-fallback-password-123",
    });
    const insertPasskey = database.prepare(
      `INSERT INTO passkey
        (id, publicKey, userId, credentialID, counter, deviceType, backedUp)
       VALUES (?, 'public-key', ?, ?, 0, 'singleDevice', 0)`,
    );
    insertPasskey.run("key-one", bootstrap.userId, "credential-one");
    insertPasskey.run("key-two", bootstrap.userId, "credential-two");

    expect(
      recordPasskeyUse({
        credentialId: "credential-two",
        database,
        nowMs: 1_500,
      }),
    ).toBe(true);
    expect(
      database
        .prepare(
          "SELECT passkey_id, last_used_at FROM passkey_usage WHERE passkey_id = 'key-two'",
        )
        .get(),
    ).toEqual({ last_used_at: 1_500, passkey_id: "key-two" });

    deleteNonFinalPasskey({
      database,
      nowMs: 2_000,
      passkeyId: "key-one",
      userId: bootstrap.userId,
    });
    expect(() =>
      deleteNonFinalPasskey({
        database,
        nowMs: 3_000,
        passkeyId: "key-two",
        userId: bootstrap.userId,
      }),
    ).toThrow();
    expect(
      database.prepare("SELECT id FROM passkey ORDER BY id").all(),
    ).toEqual([{ id: "key-two" }]);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'passkey.delete'",
        )
        .get(),
    ).toEqual({ count: 1 });
    database.close();
  });
});
