import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { rendererStylesheetUrl } from "@/compiler/render/assets";
import { readerStylesheetUrl } from "@/styles/assets";

const packagePath = new URL("../../../package.json", import.meta.url);
const dockerfilePath = new URL("../../../docker/Dockerfile", import.meta.url);
const dockerignorePath = new URL("../../../.dockerignore", import.meta.url);

describe("production renderer and style asset closure", () => {
  it("prepares versioned assets before Astro builds and never at runtime", async () => {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
      scripts: Readonly<Record<string, string>>;
    };

    expect(packageJson.scripts).toMatchObject({
      build:
        "astro build && tsc -p tsconfig.processes.json && node scripts/copy-runtime-schemas.mjs",
      prebuild: "pnpm prepare:assets",
      "prepare:assets": "pnpm prepare:renderer-assets && pnpm prepare:styles",
      start: "node dist/server/entry.mjs",
      worker: "node dist/processes/worker/index.js",
    });
    expect(packageJson.scripts["prepare:renderer-assets"]).toContain(
      "scripts/prepare-renderer-assets.mjs",
    );
    expect(packageJson.scripts["prepare:styles"]).toContain(
      "src/styles/reader.css",
    );
    expect(packageJson.scripts.start).not.toContain("prepare:");
    expect(packageJson.scripts.worker).not.toContain("prepare:");
    expect(rendererStylesheetUrl).toBe(
      "/_astro/renderers/semantic-html-v3-katex-0.18.1/katex.css",
    );
    expect(readerStylesheetUrl).toBe(
      "/_astro/styles/mirawind-reader-v1-tailwind-4.3.3.css",
    );
  });

  it("builds both asset families into the read-only Docker application closure", async () => {
    const [dockerfile, dockerignore] = await Promise.all([
      readFile(dockerfilePath, "utf8"),
      readFile(dockerignorePath, "utf8"),
    ]);

    expect(dockerfile).toContain("RUN pnpm build");
    expect(dockerfile).toContain(
      "COPY --from=build --chown=root:root /app/dist ./dist",
    );
    expect(dockerfile).toContain("RUN chmod -R a-w /app");
    expect(dockerignore).not.toMatch(/^(?:public|scripts|src\/styles)\/?$/gmu);
  });
});
