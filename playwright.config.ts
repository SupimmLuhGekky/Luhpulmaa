import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT, E2E_SERVER_URL, FAKE_LUNCHFLOW_KEY, FAKE_LUNCHFLOW_PORT, e2eEnv } from "./tests/e2e/support/env";

/**
 * End-to-end smoke tests: `npx playwright test`.
 *
 * Starts `next dev` on port 3105 against the throwaway `budget_e2e` database (override
 * with E2E_DATABASE_URL; the name must end in `_e2e`), plus a stand-in for Lunch Flow's
 * API on port 3106. The global setup migrates the database, empties it and seeds the
 * demo account. Set E2E_BASE_URL to test a server you started yourself (pointed at the
 * same database and at the stand-in) instead.
 */
const env = e2eEnv();
const external = process.env.E2E_BASE_URL;
// E2E_CHROMIUM, else a preinstalled Chromium where there is one, else the browser from `npx playwright install chromium`.
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const chromium = process.env.E2E_CHROMIUM || (existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined);

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
      use: { ...devices["Desktop Chrome"], launchOptions: chromium ? { executablePath: chromium } : {} },
    },
  ],
  webServer: external
    ? undefined
    : [
        {
          command: "node tests/e2e/support/fake-lunchflow.mjs",
          url: `http://localhost:${FAKE_LUNCHFLOW_PORT}/health`,
          env: { FAKE_LUNCHFLOW_PORT: String(FAKE_LUNCHFLOW_PORT), FAKE_LUNCHFLOW_KEY },
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: `npx next dev --port ${E2E_PORT}`,
          url: `${E2E_SERVER_URL}/api/health`,
          env,
          // Never test against whatever else is listening on the port (it may use another database).
          reuseExistingServer: false,
          timeout: 180_000,
        },
      ],
});
