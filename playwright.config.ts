import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const configuredPort = Number(process.env.MIRAWIND_E2E_PORT ?? "4321");
if (
  !Number.isSafeInteger(configuredPort) ||
  configuredPort < 1_024 ||
  configuredPort > 65_535
) {
  throw new Error("MIRAWIND_E2E_PORT must be an integer from 1024 to 65535");
}
const port = configuredPort;
const baseURL = `http://127.0.0.1:${port}`;
const dataRoot = resolve(".cache/e2e-playwright-ir-data");

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
    extraHTTPHeaders: {
      "x-real-ip": "127.0.0.1",
    },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "library-mobile",
      testMatch: /library-reading\.spec\.ts/u,
      use: {
        ...devices["Desktop Chrome"],
        hasTouch: true,
        isMobile: true,
        viewport: { height: 800, width: 360 },
      },
    },
    {
      name: "library-no-javascript",
      testMatch: /library-reading\.spec\.ts/u,
      use: {
        ...devices["Desktop Chrome"],
        javaScriptEnabled: false,
      },
    },
  ],
  webServer: {
    command:
      "pnpm exec tsx tests/helpers/clean-e2e-data.ts && MIRAWIND_E2E_PREPARE_ONLY=1 pnpm exec tsx tests/helpers/global-setup.ts && pnpm build && pnpm start",
    env: {
      MIRAWIND_ALLOWED_HOSTS: "127.0.0.1,localhost",
      MIRAWIND_AUTH_SECRET: "test-only-secret-0123456789-abcdef",
      MIRAWIND_DATA_DIR: dataRoot,
      MIRAWIND_PASSKEY_RP_ID: "127.0.0.1",
      MIRAWIND_PUBLIC_ORIGIN: baseURL,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
});
