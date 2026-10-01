/**
 * Integration-test setup (runs before every integration test file).
 *
 *  - Refuses to run against any database whose name does not end in "_test".
 *  - Uses throwaway secrets generated per run (never real ones).
 *  - Applies migrations once (prisma migrate deploy) when the schema is behind.
 *  - Empties every table before each test file.
 *  - Replaces `next/headers` with an in-memory request (cookies + headers).
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, vi } from "vitest";

const DEFAULT_TEST_DATABASE_URL = "postgresql://budget:budget@localhost:5432/budget_test?schema=public";

const databaseUrl = process.env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
const databaseName = (() => {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
})();
if (!databaseName.endsWith("_test")) {
  throw new Error(`Refusing to run integration tests against database "${databaseName || databaseUrl}": its name must end in "_test".`);
}

Object.assign(process.env, {
  NODE_ENV: "test",
  APP_ENV: "test",
  DATABASE_URL: databaseUrl,
  AUTH_SECRET: randomBytes(32).toString("base64url"),
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  CRON_SECRET: randomBytes(24).toString("base64url"),
  APP_URL: "http://localhost:3105",
  BANKING_PROVIDER: "mock",
  EMAIL_PROVIDER: "console",
  DEMO_MODE: "true",
  ENABLE_AI_CATEGORIZATION: "false",
  ENABLE_AI_ASSISTANT: "false",
  // Rate limits are exercised explicitly in the auth tests.
  DISABLE_RATE_LIMIT: "true",
});
delete process.env.ANTHROPIC_API_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.PLAID_CLIENT_ID;
delete process.env.PLAID_SECRET;
delete process.env.FLINKS_SECRET;
delete process.env.MOCK_TODAY;

vi.mock("next/headers", () => import("./helpers/next-headers"));

const globalState = globalThis as unknown as { __harbourMigrated?: boolean };

async function ensureMigrated() {
  if (globalState.__harbourMigrated) return;
  const { prisma } = await import("@/lib/db/prisma");
  const expected = readdirSync(join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  let applied: string[] = [];
  const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "exists"`);
  if (exists) {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    applied = rows.map((r) => r.migration_name);
  }
  if (expected.some((name) => !applied.includes(name))) {
    execFileSync(join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
  }
  globalState.__harbourMigrated = true;
}

async function truncateAll() {
  const { prisma } = await import("@/lib/db/prisma");
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (!tables.length) return;
  const list = tables.map((t) => `"public"."${t.tablename.replace(/"/g, '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

beforeAll(async () => {
  await ensureMigrated();
  await truncateAll();
  const { requestContext } = await import("./helpers/next-headers");
  requestContext.reset();
});

afterAll(async () => {
  const { prisma } = await import("@/lib/db/prisma");
  await prisma.$disconnect();
});
