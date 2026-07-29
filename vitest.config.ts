import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const schemaRoot = fileURLToPath(new URL("./docs/schemas", import.meta.url));
const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));

const shared = {
  environment: "node",
  globals: false,
  restoreMocks: true,
  testTimeout: 30_000,
};

export default defineConfig({
  resolve: {
    alias: [
      { find: "@/schemas", replacement: schemaRoot },
      { find: "@", replacement: sourceRoot },
    ],
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          ...shared,
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          name: "unit",
        },
      },
      {
        extends: true,
        test: {
          ...shared,
          include: ["tests/integration/**/*.test.{ts,tsx}"],
          name: "integration",
          sequence: { concurrent: false },
        },
      },
      {
        extends: true,
        test: {
          ...shared,
          include: ["tests/contract/**/*.test.{ts,tsx}"],
          name: "contract",
        },
      },
      {
        extends: true,
        test: {
          ...shared,
          include: ["tests/architecture/**/*.test.ts"],
          name: "architecture",
        },
      },
    ],
  },
});
