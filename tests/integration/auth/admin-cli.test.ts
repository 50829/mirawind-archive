import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { runAdminCli, type AdminCliDependencies } from "@/cli/admin-cli";

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
});
