/**
 * Runs the daily background jobs once for every user.
 *   npm run jobs:daily
 * Schedule it with cron/systemd when self-hosting; on Vercel the /api/cron/daily
 * route does the same work (see vercel.json).
 */
import { runDailyJobs } from "@/lib/jobs/daily";
import { prisma } from "@/lib/db/prisma";

async function main() {
  const result = await runDailyJobs();
  console.info(`[jobs] daily run finished: ${JSON.stringify(result)}`);
  if (!result.skipped && result.failedSteps > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[jobs] daily run crashed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
