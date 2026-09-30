/**
 * Development seed: (re)creates the demo account demo@example.com with ~6 months of
 * simulated bank activity, goals, budgets, bills, subscriptions, income, automations
 * and net-worth history — all generated through the app's own services.
 *
 *   npm run db:seed
 */
import { prisma } from "@/lib/db/prisma";
import { DEMO_EMAIL, DEMO_PASSWORD, ensureDemoUser } from "@/lib/demo";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data in production (set ALLOW_DEMO_SEED=true for a demo deployment).");
  }
  const started = Date.now();
  const user = await ensureDemoUser({ reset: true });
  const [accounts, transactions, goals, budgets, bills, subscriptions, notifications] = await Promise.all([
    prisma.account.count({ where: { userId: user.id } }),
    prisma.transaction.count({ where: { userId: user.id } }),
    prisma.goal.count({ where: { userId: user.id } }),
    prisma.budget.count({ where: { userId: user.id } }),
    prisma.bill.count({ where: { userId: user.id } }),
    prisma.subscription.count({ where: { userId: user.id } }),
    prisma.notification.count({ where: { userId: user.id } }),
  ]);
  console.info(
    `[seed] demo account ready in ${Math.round((Date.now() - started) / 100) / 10}s — ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n` +
      `       ${accounts} accounts, ${transactions} transactions, ${goals} goals, ${budgets} budgets, ${bills} bills, ${subscriptions} subscriptions, ${notifications} notifications`,
  );
}

main()
  .catch((error) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
