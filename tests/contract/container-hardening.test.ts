import { readFile, readdir } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const composePath = new URL("../../docker/compose.yaml", import.meta.url);
const dockerfilePath = new URL("../../docker/Dockerfile", import.meta.url);
const caddyfilePath = new URL("../../docker/Caddyfile", import.meta.url);
const dockerignorePath = new URL("../../.dockerignore", import.meta.url);
const migrationDirectory = new URL("../../src/db/migrations/", import.meta.url);
const runtimeCopyScript = new URL(
  "../../scripts/copy-runtime-schemas.mjs",
  import.meta.url,
);

interface ComposeService {
  cap_drop?: readonly string[];
  depends_on?: Readonly<Record<string, { readonly condition?: string }>>;
  healthcheck?: { readonly test?: readonly string[] };
  init?: boolean;
  read_only?: boolean;
  security_opt?: readonly string[];
  stop_grace_period?: string;
  stop_signal?: string;
  tmpfs?: readonly string[];
  user?: string;
  volumes?: readonly string[];
}

describe("container deployment hardening", () => {
  it("runs both application processes non-root with read-only roots and a writable data volume", async () => {
    const compose = parse(await readFile(composePath, "utf8")) as {
      services: Record<string, ComposeService>;
    };
    for (const name of ["web", "worker"]) {
      const service = compose.services[name];
      expect(service).toMatchObject({
        cap_drop: ["ALL"],
        init: true,
        read_only: true,
        security_opt: ["no-new-privileges:true"],
        stop_grace_period: "20s",
        stop_signal: "SIGTERM",
        user: "10001:10001",
      });
      expect(service?.tmpfs?.some((mount) => mount.startsWith("/tmp:"))).toBe(
        true,
      );
      expect(service?.volumes).toContain("mirawind-data:/var/lib/mirawind");
      expect(service?.healthcheck?.test).toEqual([
        "CMD",
        "node",
        "/app/healthcheck.mjs",
        name,
      ]);
      expect(service?.depends_on?.["data-init"]?.condition).toBe(
        "service_completed_successfully",
      );
      expect(service?.depends_on?.["migrate"]?.condition).toBe(
        "service_completed_successfully",
      );
    }
    expect(compose.services["data-init"]).toMatchObject({
      network_mode: "none",
      read_only: true,
      user: "0:0",
    });
    expect(compose.services["migrate"]).toMatchObject({
      network_mode: "none",
      read_only: true,
      user: "10001:10001",
    });
  });

  it("makes the image application tree root-owned and non-writable", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain(
      "install -d -o mirawind -g mirawind -m 0700 /var/lib/mirawind",
    );
    expect(dockerfile).toContain("--chown=root:root /app/dist");
    expect(dockerfile).toContain("chmod -R a-w /app");
    expect(dockerfile).toContain("USER mirawind");
    expect(await readFile(dockerignorePath, "utf8")).toContain(".cache/");
  });

  it("sets browser isolation, transport and content security headers at Caddy", async () => {
    const caddyfile = await readFile(caddyfilePath, "utf8");
    for (const header of [
      "Content-Security-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]) {
      expect(caddyfile).toContain(header);
    }
    expect(caddyfile).toContain("header_up X-Real-IP {remote_host}");
    expect(caddyfile).toContain("header_up X-Forwarded-Host {host}");
    expect(caddyfile).toContain("header_up X-Forwarded-Proto {scheme}");
  });

  it("copies every SQL migration into the production process build", async () => {
    const [migrations, copyScript] = await Promise.all([
      readdir(migrationDirectory),
      readFile(runtimeCopyScript, "utf8"),
    ]);
    for (const migration of migrations.filter((name) =>
      name.endsWith(".sql"),
    )) {
      expect(copyScript).toContain(`"${migration}"`);
    }
  });
});
