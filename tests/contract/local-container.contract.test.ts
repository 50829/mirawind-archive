import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const localComposePath = new URL(
  "../../docker/compose.local.yaml",
  import.meta.url,
);

describe("local Docker launcher", () => {
  it("publishes only the local Web port and preserves separate Web and worker processes", async () => {
    const compose = parse(await readFile(localComposePath, "utf8")) as {
      services: Record<
        string,
        {
          environment?: Record<string, string>;
          ports?: string[];
          profiles?: string[];
        }
      >;
    };

    expect(compose.services.web).toMatchObject({
      environment: {
        MIRAWIND_ALLOWED_HOSTS: "localhost,127.0.0.1",
        MIRAWIND_DATA_DIR: "/var/lib/mirawind",
        MIRAWIND_LOCAL_DEVELOPMENT_TRUST: "1",
        MIRAWIND_PASSKEY_RP_ID: "localhost",
        MIRAWIND_PUBLIC_ORIGIN: "http://localhost:4321",
        NODE_ENV: "development",
      },
      ports: ["127.0.0.1:4321:4321"],
    });
    expect(compose.services.worker?.environment).toMatchObject({
      MIRAWIND_DATA_DIR: "/var/lib/mirawind",
      MIRAWIND_PUBLIC_ORIGIN: "http://localhost:4321",
      NODE_ENV: "development",
    });
    expect(compose.services.caddy?.profiles).toEqual(["production-proxy"]);
  });
});
