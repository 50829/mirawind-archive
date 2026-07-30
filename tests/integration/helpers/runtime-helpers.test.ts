import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { fetchWithTimeout, waitForHttp } from "../../helpers/http";
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
    expect({
      body: await response.json(),
      cacheControl: response.headers.get("cache-control"),
      robotsTag: response.headers.get("x-robots-tag"),
      status: response.status,
    }).toEqual({
      body: { ready: true },
      cacheControl: "private, no-store",
      robotsTag: "noindex",
      status: 200,
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
