import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const localComposePath = new URL(
  "../../docker/compose.local.yaml",
  import.meta.url,
);
const localScriptPath = new URL("../../docker/local.sh", import.meta.url);

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

  it("uses an interactive offline bootstrap and never accepts a password variable", async () => {
    const script = await readFile(localScriptPath, "utf8");
    const startStack = script.slice(
      script.indexOf("start_stack()"),
      script.indexOf("\nusage()"),
    );

    expect(script).toContain('--project-name "${project_name}"');
    expect(script).toContain(
      "node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d",
    );
    expect(script).toContain("randomBytes(48)");
    expect(script).not.toContain("openssl rand");
    expect(script).toContain(
      "SELECT admin_user_id FROM installation WHERE id = 1",
    );
    expect(script).toContain("admin bootstrap");
    expect(script).toContain("compose up --detach --no-build --wait");
    expect(startStack).toMatch(
      /compose build\s+compose stop worker\s+compose stop web\s+compose run --rm data-init/,
    );
    expect(script).toMatch(/compose stop worker\s+compose stop web/);
    expect(script).not.toMatch(/ADMIN_(?:PASSWORD|PASS)|MIRAWIND_PASSWORD/);
  });
});
