import "server-only";
import { prisma } from "@/lib/db/prisma";
import { addDays, addMonths, fromDbDate, startOfMonth, todayIn, toDbDate, type LocalDate } from "@/lib/dates";
import { toCents } from "@/lib/finance/money";
import { hashPassword } from "@/lib/auth/password";
import { provisionDefaultCategories } from "@/lib/categories/provision";
import { provisionNotificationPreferences } from "@/lib/notifications/preferences";
import { completeConnection, createManualAccount } from "@/lib/accounts/service";
import { createGoal, addContribution } from "@/lib/goals/service";
import { createAutomation } from "@/lib/automation/service";
import { createBudget, upsertBudgetItem } from "@/lib/budget/service";
import { subscriptionFromRecurring } from "@/lib/subscriptions/service";
import { syncAllForUser } from "@/lib/sync/service";
import { runDailyJobsForUser } from "@/lib/jobs/daily";
import { reconstructHistory } from "@/lib/networth/history";

/**
 * Demo account. Every number in it comes from the MOCK bank provider's simulated
 * transactions run through the real pipeline (sync → dedupe → categorise →
 * automations → recurring detection), plus a few goals, budgets and manual
 * accounts created with the same services a user would use. Nothing is hardcoded
 * into the UI, and every simulated account is labelled as demo data.
 */
export const DEMO_EMAIL = "demo@example.com";
/** Documented in the README. Demo mode must stay off in real deployments. */
export const DEMO_PASSWORD = "harbour-demo-2026";

const RESYNC_AFTER_MS = 6 * 60 * 60 * 1000;

export async function ensureDemoUser(opts: { reset?: boolean } = {}) {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true, isDemo: true } });
  if (existing && !existing.isDemo) throw new Error("demo@example.com belongs to a real account; refusing to touch it.");
  if (existing && opts.reset) {
    await prisma.user.delete({ where: { id: existing.id } });
  } else if (existing) {
    await refreshDemo(existing.id);
    return existing;
  }
  return createDemoUser();
}

async function refreshDemo(userId: string) {
  const stale = await prisma.providerConnection.findFirst({
    where: { userId, status: { not: "DISCONNECTED" }, OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - RESYNC_AFTER_MS) } }] },
    select: { id: true },
  });
  if (stale) await syncAllForUser(userId, "scheduled");
}

async function categoryId(userId: string, systemKey: string) {
  const c = await prisma.category.findUniqueOrThrow({ where: { userId_systemKey: { userId, systemKey } }, select: { id: true } });
  return c.id;
}

async function createDemoUser() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: DEMO_EMAIL,
        firstName: "Alex",
        lastName: "Tremblay",
        passwordHash,
        passwordChangedAt: new Date(),
        emailVerifiedAt: new Date(),
        country: "CA",
        province: "QC",
        currency: "CAD",
        locale: "en-CA",
        timeZone: "America/Toronto",
        monthlyIncomeTargetCents: 400_000,
        minCashBufferCents: 50_000,
        onboardingCompletedAt: new Date(),
        onboardingStep: 9,
        isDemo: true,
        preferences: { budgetAlertThresholds: [80, 100], largeTransactionCents: 50_000, billReminderDays: 3, includeSavingsInSafeToSpend: false, roundOverviewAmounts: false, theme: "system", aiOptIn: false },
      },
    });
    await provisionDefaultCategories(tx, created.id);
    await provisionNotificationPreferences(tx, created.id);
    return created;
  });
  const userId = user.id;
  const today = todayIn(user.timeZone);

  // Goals first, so automations can reference them.
  const car = await createGoal(userId, { name: "Car Fund", description: "Down payment for a used hybrid.", targetCents: 750_000, deadline: nextDate(today, 6, 1), priority: "HIGH", icon: "car", color: "#0ea5e9" });
  const emergency = await createGoal(userId, { name: "Emergency Fund", description: "Three months of essential expenses.", targetCents: 500_000, priority: "HIGH", icon: "shield", color: "#10b981" });
  const vacation = await createGoal(userId, { name: "Vacation", description: "Gaspésie road trip.", targetCents: 300_000, deadline: nextDate(today, 7, 15), priority: "MEDIUM", icon: "plane", color: "#f59e0b" });
  await createGoal(userId, { name: "New PC", targetCents: 200_000, startingCents: 35_000, priority: "LOW", icon: "smartphone", color: "#8b5cf6" });

  const transportation = await categoryId(userId, "transportation");
  await createAutomation(userId, {
    name: "Payday: plan 10% for the Car Fund",
    description: "Every paycheque, set aside 10% as a planned allocation.",
    trigger: "INCOME_RECEIVED",
    triggerConfig: {},
    conditionLogic: "ALL",
    isActive: true,
    conditions: [],
    actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: car.id, percentBps: 1000 } }],
  });
  await createAutomation(userId, {
    name: "Round up purchases for Vacation",
    trigger: "TRANSACTION_CREATED",
    triggerConfig: {},
    conditionLogic: "ALL",
    isActive: true,
    conditions: [{ field: "TYPE", operator: "EQUALS", value: "EXPENSE" }],
    actions: [{ type: "ROUND_UP_TO_GOAL", config: { goalId: vacation.id, roundToCents: 100 } }],
  });
  await createAutomation(userId, {
    name: "Uber rides → Transportation",
    trigger: "TRANSACTION_CREATED",
    triggerConfig: {},
    conditionLogic: "ALL",
    isActive: true,
    conditions: [{ field: "MERCHANT", operator: "EQUALS", value: "Uber" }],
    actions: [{ type: "SET_CATEGORY", config: { categoryId: transportation } }],
  });
  await createAutomation(userId, {
    name: "Tag large purchases",
    trigger: "TRANSACTION_CREATED",
    triggerConfig: {},
    conditionLogic: "ALL",
    isActive: true,
    conditions: [
      { field: "AMOUNT", operator: "GREATER_THAN", value: "10000" },
      { field: "TYPE", operator: "EQUALS", value: "EXPENSE" },
    ],
    actions: [{ type: "ADD_TAG", config: { tagName: "Large Purchase" } }],
  });
  await createAutomation(userId, {
    name: "Monthly $150 for the Emergency Fund",
    trigger: "SCHEDULE_MONTHLY",
    triggerConfig: { dayOfMonth: 1 },
    conditionLogic: "ALL",
    isActive: true,
    conditions: [],
    actions: [{ type: "ALLOCATE_TO_GOAL", config: { goalId: emergency.id, amountCents: 15_000 } }],
  });
  await createAutomation(userId, {
    name: "Heads-up when restaurants reach 90%",
    trigger: "BUDGET_THRESHOLD",
    triggerConfig: { thresholdPercent: 90, categoryId: await categoryId(userId, "restaurants") },
    conditionLogic: "ALL",
    isActive: true,
    conditions: [],
    actions: [{ type: "NOTIFY", config: { title: "Restaurants budget at 90%", message: "Time to cook at home for the rest of the month?" } }],
  });

  // Budgets for the last two months and this month (so rollovers have history).
  // [category, monthly amount, rollover, alert thresholds]
  const plan: [string, number, boolean, number[]][] = [
    ["housing", 125_000, false, [100]],
    ["utilities", 25_000, false, [100]],
    ["insurance", 9_000, false, [100]],
    ["groceries", 80_000, true, [80, 100]],
    ["restaurants", 30_000, false, [75, 90, 100]],
    ["transportation", 20_000, false, [80, 100]],
    ["gas", 15_000, false, [80, 100]],
    ["shopping", 25_000, false, [80, 100]],
    ["entertainment", 15_000, true, [80, 100]],
    ["subscriptions", 8_000, false, [100]],
    ["healthcare", 8_000, false, [80, 100]],
  ];
  const firstBudget = await createBudget(userId, { period: "MONTHLY", startDate: addMonths(startOfMonth(today), -2), copyFromPrevious: false, plannedIncomeCents: 400_000 });
  for (const [key, amount, rollover, alertThresholds] of plan) {
    await upsertBudgetItem(userId, firstBudget.id, null, { categoryId: await categoryId(userId, key), amountType: "FIXED", amountCents: amount, rolloverEnabled: rollover, alertThresholds });
  }
  await createBudget(userId, { period: "MONTHLY", startDate: addMonths(startOfMonth(today), -1), copyFromPrevious: true });
  await createBudget(userId, { period: "MONTHLY", startDate: today, copyFromPrevious: true });

  // Simulated bank connection through the MOCK provider: imports ~6 months of activity.
  const connection = await completeConnection(userId, "mock-public:mock_maple", {}, { providerType: "MOCK" });

  // Manual accounts round out net worth (assets and debts held elsewhere).
  await createManualAccount(userId, { name: "Retirement savings (RRSP)", type: "INVESTMENT", institutionName: "Brokerage (manual)", currency: "CAD", balanceCents: 1_240_000 });
  await createManualAccount(userId, { name: "Car loan", type: "LOAN", institutionName: "Auto lender (manual)", currency: "CAD", balanceCents: 890_000 });
  const accountIds = (await prisma.account.findMany({ where: { userId }, select: { id: true } })).map((a) => a.id);
  await prisma.netWorthSnapshot.deleteMany({ where: { userId, date: { lt: toDbDate(today) } } });
  await reconstructHistory(userId, accountIds, today, 180);

  // Emergency Fund: record the real (simulated-bank) transfers to savings from the last 3 months.
  const savings = await prisma.account.findFirst({ where: { userId, connectionId: connection.connectionId, type: "SAVINGS" }, select: { id: true } });
  if (savings) {
    await prisma.goal.update({ where: { id: emergency.id }, data: { linkedAccountId: savings.id } });
    const transfers = await prisma.transaction.findMany({
      where: { userId, accountId: savings.id, amountCents: { gt: 0 }, description: { contains: "TRANSFER FROM CHEQUING" }, date: { gte: toDbDate(addMonths(today, -3)) } },
      orderBy: { date: "asc" },
      select: { id: true, date: true, amountCents: true },
    });
    for (const t of transfers) {
      await addContribution(userId, emergency.id, {
        amountCents: toCents(t.amountCents),
        date: fromDbDate(t.date),
        kind: "USER_REPORTED_TRANSFER",
        source: "MANUAL",
        transactionId: t.id,
        note: "Transfer to High Interest Savings",
        idempotencyKey: `demo:emergency:${t.id}`,
      });
    }
  }

  // The demo's history starts months ago, so a goal shouldn't look newer than its first contribution.
  const goals = await prisma.goal.findMany({ where: { userId }, select: { id: true, createdAt: true, contributions: { orderBy: { date: "asc" }, take: 1, select: { date: true } } } });
  for (const g of goals) {
    const first = g.contributions[0]?.date;
    if (first && first < g.createdAt) await prisma.goal.update({ where: { id: g.id }, data: { createdAt: first } });
  }

  // Phone and internet are tracked as subscriptions too (linked to the same series as their bills).
  const series = await prisma.recurringTransaction.findMany({ where: { userId, direction: "OUTFLOW", name: { in: ["Fizz", "Vidéotron"] } }, select: { id: true } });
  for (const s of series) await subscriptionFromRecurring(userId, s.id);

  // Daily jobs: bill reconciliation, reminders, budget alerts, goal deadlines, snapshots.
  await runDailyJobsForUser(userId, { steps: ["bills", "reminders", "budgets", "goals", "netWorth"] });

  // Like a real inbox: the newest few notifications unread, the rest already read.
  const recent = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true } });
  await prisma.notification.updateMany({ where: { userId, id: { notIn: recent.map((n) => n.id) } }, data: { readAt: new Date() } });

  return { id: userId, isDemo: true };
}

/** Next occurrence of month/day strictly after `today` (e.g. next June 1). */
function nextDate(today: LocalDate, month: number, day: number): LocalDate {
  const year = Number(today.slice(0, 4));
  const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return candidate > addDays(today, 60) ? candidate : `${year + 1}-${candidate.slice(5)}`;
}
