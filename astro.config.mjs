import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

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
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      allowedHosts,
    },
  },
});
