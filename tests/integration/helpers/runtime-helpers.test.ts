import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createTemporaryDataRoot } from "../../helpers/data-root";
import { openMigratedTestDatabase } from "../../helpers/database";
import {
  assertResponsePolicy,
  fetchWithTimeout,
  readJsonBody,
  waitForHttp,
} from "../../helpers/http";
import {
  reserveTcpPort,
  startManagedTestProcess,
} from "../../helpers/processes";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe("isolated runtime test helpers", () => {
  it("creates a private removable data root and migrated real SQLite", async () => {
    const dataRoot = await createTemporaryDataRoot("helper-proof");
    cleanups.push(dataRoot.cleanup);
    const database = await openMigratedTestDatabase(dataRoot);
    cleanups.push(async () => database.close());

    expect(database.schemaVersion).toBe(5);
    expect(
      database.database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'books'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(database.database.pragma("journal_mode", { simple: true })).toBe(
      "wal",
    );
    expect(database.path.startsWith(dataRoot.path)).toBe(true);
  });

  it("performs bounded HTTP requests and verifies response policy", async () => {
    const port = await reserveTcpPort();
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/json",
        "X-Robots-Tag": "noindex",
      });
      response.end(JSON.stringify({ ready: true }));
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(port, "127.0.0.1", resolveListen);
    });
    cleanups.push(
      () =>
        new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) rejectClose(error);
            else resolveClose();
          });
        }),
    );

    const response = await waitForHttp(`http://127.0.0.1:${port}/health`);
    assertResponsePolicy(response, {
      cacheControl: "private, no-store",
      robotsTag: "noindex",
      status: 200,
    });
    expect(await readJsonBody<{ ready: boolean }>(response)).toEqual({
      ready: true,
    });
    await expect(
      fetchWithTimeout(`http://127.0.0.1:${port}/slow`, {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
  });

  it("starts and terminates direct child processes without a shell", async () => {
    const child = startManagedTestProcess(process.execPath, [
      "-e",
      "process.stdout.write('helper-ready\\\\n'); setInterval(() => {}, 1000)",
    ]);
    cleanups.push(child.stop);

    expect(await child.waitForOutput(/helper-ready/)).toContain("helper-ready");
    await child.stop();
    expect(child.child.signalCode).toBe("SIGTERM");
  });
});
