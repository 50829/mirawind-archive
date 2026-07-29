import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));
const schemaRoot = fileURLToPath(new URL("./docs/schemas", import.meta.url));
const outputDirectory =
  process.env.MIRAWIND_PROCESS_OUT_DIR ??
  fileURLToPath(new URL("./dist/processes", import.meta.url));
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

function isExternal(id: string): boolean {
  return (
    builtins.has(id) ||
    (!id.startsWith(".") && !id.startsWith("/") && !id.startsWith("@/"))
  );
}

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: outputDirectory,
    rollupOptions: {
      external: isExternal,
      input: {
        "cli/index": fileURLToPath(
          new URL("./src/entrypoints/cli/index.ts", import.meta.url),
        ),
        "worker/index": fileURLToPath(
          new URL("./src/entrypoints/worker/index.ts", import.meta.url),
        ),
        "worker/job-child": fileURLToPath(
          new URL("./src/entrypoints/worker/job-child.ts", import.meta.url),
        ),
      },
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        entryFileNames: "[name].js",
      },
    },
    sourcemap: true,
    ssr: true,
    target: "node24",
  },
  resolve: {
    alias: [
      { find: "@/schemas", replacement: schemaRoot },
      { find: "@", replacement: sourceRoot },
    ],
  },
});
