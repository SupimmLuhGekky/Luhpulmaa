import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { e2eEnv } from "./support/env";

const root = fileURLToPath(new URL("../..", import.meta.url));

function run(command: string, env: Record<string, string>) {
  try {
    execSync(command, { cwd: root, env: { ...process.env, ...env }, stdio: "pipe" });
  } catch (error) {
    const e = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`"${command}" failed:\n${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`);
  }
}

/**
 * Brings the `*_e2e` database to a known state before every run: migrations applied,
 * every table emptied, then the demo account seeded (demo@example.com, fictional data).
 * Playwright starts the web server before this runs; its readiness probe (/api/health)
 * doesn't need any table.
 */
export default async function globalSetup() {
  const env = e2eEnv(); // throws unless the database name ends in _e2e
  run("npx prisma migrate deploy", env);

  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  } finally {
    await prisma.$disconnect();
  }

  run("npx tsx --conditions=react-server prisma/seed.ts", env);
}
