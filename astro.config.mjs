import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

const schemaRoot = fileURLToPath(new URL("./docs/schemas", import.meta.url));
const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));

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
    plugins: [tailwindcss()],
    resolve: {
      alias: [
        { find: "@/schemas", replacement: schemaRoot },
        { find: "@", replacement: sourceRoot },
      ],
    },
    server: {
      allowedHosts,
    },
  },
});
