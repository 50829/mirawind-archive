import { defineConfig } from "vitest/config";

const shared = {
  environment: "node",
  globals: false,
  restoreMocks: true,
  testTimeout: 30_000,
};

export default defineConfig({
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
        test: {
          ...shared,
          include: ["tests/unit/**/*.test.ts"],
          name: "unit",
        },
      },
      {
        test: {
          ...shared,
          include: ["tests/integration/**/*.test.ts"],
          name: "integration",
          sequence: { concurrent: false },
        },
      },
      {
        test: {
          ...shared,
          include: ["tests/contract/**/*.test.ts"],
          name: "contract",
        },
      },
    ],
  },
});
