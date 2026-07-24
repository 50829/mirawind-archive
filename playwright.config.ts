import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const port = 4321;
const baseURL = `http://127.0.0.1:${port}`;
const dataRoot = resolve(".cache/e2e-playwright-data");

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/helpers/global-setup.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    env: {
      MIRAWIND_ALLOWED_HOSTS: "127.0.0.1,localhost",
      MIRAWIND_AUTH_SECRET: "test-only-secret-0123456789-abcdef",
      MIRAWIND_DATA_DIR: dataRoot,
      MIRAWIND_PASSKEY_RP_ID: "127.0.0.1",
      MIRAWIND_PUBLIC_ORIGIN: baseURL,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
});
