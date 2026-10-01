import { randomBytes } from "node:crypto";

/**
 * Settings for the end-to-end server, seed and helpers. Nothing comes from a `.env`
 * file: secrets are random per run and the database must be a throwaway `*_e2e` one.
 */
export const DEFAULT_E2E_DATABASE_URL = "postgresql://budget:budget@localhost:5432/budget_e2e?schema=public";
export const E2E_PORT = 3105;
export const E2E_SERVER_URL = `http://localhost:${E2E_PORT}`;

/** The stand-in for Lunch Flow's API (support/fake-lunchflow.mjs) and the only key it accepts. */
export const FAKE_LUNCHFLOW_PORT = 3106;
export const FAKE_LUNCHFLOW_KEY = "lf-fictional-test-key";

export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL || DEFAULT_E2E_DATABASE_URL;
  assertE2eDatabase(url);
  return url;
}

/** Refuses anything but a database whose name ends in `_e2e`: the setup truncates it. */
export function assertE2eDatabase(url: string): void {
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    // reported below
  }
  if (!name.endsWith("_e2e")) {
    throw new Error(`End-to-end tests only run against a database whose name ends in "_e2e" (got "${name || url}"). Set E2E_DATABASE_URL.`);
  }
}

// Keys that could reach a real third-party service or change how the app behaves.
const SCRUBBED = [
  "ANTHROPIC_API_KEY",
  "RESEND_API_KEY",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "PLAID_WEBHOOK_URL",
  "FLINKS_CUSTOMER_ID",
  "FLINKS_API_URL",
  "FLINKS_CONNECT_URL",
  "FLINKS_SECRET",
  "FLINKS_API_KEY",
  "LUNCHFLOW_API_URL",
  "MOCK_TODAY",
];

/** Generated once in the runner process; the server, the seed and the workers inherit them. */
function secret(name: string, bytes: number): string {
  const key = `HARBOUR_E2E_${name}`;
  process.env[key] ||= randomBytes(bytes).toString("base64");
  return process.env[key]!;
}

/** Environment for the dev server and the seed. Also drops third-party keys from this process. */
export function e2eEnv(): Record<string, string> {
  for (const key of SCRUBBED) delete process.env[key];
  return {
    DATABASE_URL: e2eDatabaseUrl(),
    APP_URL: E2E_SERVER_URL,
    APP_ENV: "development",
    AUTH_SECRET: secret("AUTH_SECRET", 48),
    ENCRYPTION_KEY: secret("ENCRYPTION_KEY", 32),
    CRON_SECRET: secret("CRON_SECRET", 48),
    BANKING_PROVIDER: "mock",
    // Lunch Flow calls go to the local stand-in, never to lunchflow.app.
    LUNCHFLOW_API_URL: `http://localhost:${FAKE_LUNCHFLOW_PORT}/api/v1`,
    EMAIL_PROVIDER: "console",
    DEMO_MODE: "true",
    ENABLE_BANKING: "true",
    ENABLE_CSV_IMPORT: "true",
    ENABLE_AUTOMATIONS: "true",
    ENABLE_NOTIFICATIONS: "true",
    ENABLE_AI_CATEGORIZATION: "false",
    ENABLE_AI_ASSISTANT: "false",
    ENABLE_MULTI_CURRENCY: "false",
    HARBOUR_DESKTOP: "false",
    // Each test signs up a new user from the same IP (5 sign-ups an hour otherwise).
    DISABLE_RATE_LIMIT: "true",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
