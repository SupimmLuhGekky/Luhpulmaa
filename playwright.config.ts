import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT, E2E_SERVER_URL, e2eEnv } from "./tests/e2e/support/env";

/**
 * End-to-end smoke tests: `npx playwright test`.
 *
 * Starts `next dev` on port 3105 against the throwaway `budget_e2e` database (override
 * with E2E_DATABASE_URL; the name must end in `_e2e`). The global setup migrates it,
 * empties it and seeds the demo account. Set E2E_BASE_URL to test a server you started
 * yourself (pointed at the same database) instead.
 */
const env = e2eEnv();
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  // One dev server compiles pages on first use; parallel workers would only queue behind it.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL: external || E2E_SERVER_URL,
    locale: "en-CA",
    timezoneId: "America/Toronto",
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // A preinstalled Chromium (no `playwright install`); E2E_CHROMIUM points elsewhere.
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.E2E_CHROMIUM || "/opt/pw-browsers/chromium" } },
    },
  ],
  webServer: external
    ? undefined
    : {
        command: `npx next dev --port ${E2E_PORT}`,
        url: `${E2E_SERVER_URL}/api/health`,
        env,
        // Never test against whatever else is listening on the port (it may use another database).
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
