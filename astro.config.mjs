import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

const schemaRoot = fileURLToPath(new URL("./docs/schemas", import.meta.url));
const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));
const viteCacheRoot = fileURLToPath(
  new URL(
    process.env.NODE_ENV === "development" &&
      process.env.MIRAWIND_LOCAL_DEVELOPMENT_TRUST === "1"
      ? "./node_modules/.vite-development/"
      : "./node_modules/.vite-tooling/",
    import.meta.url,
  ),
);

const allowedHosts = (
  process.env.MIRAWIND_ALLOWED_HOSTS ?? "localhost,127.0.0.1"
)
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  output: "server",
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
  vite: {
    cacheDir: viteCacheRoot,
    plugins: [tailwindcss()],
    resolve: {
      alias: [
        { find: "@/schemas", replacement: schemaRoot },
        { find: "@", replacement: sourceRoot },
      ],
    },
    server: {
      allowedHosts,
      watch: {
        ignored: [
          "**/.cache/**",
          "**/data/**",
          "**/tests/fixtures/mineru/real/**",
          "**/tests/fixtures/epub/**",
          "**/test-results/**",
          "**/playwright-report/**",
        ],
      },
    },
  },
});
