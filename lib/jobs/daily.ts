import "server-only";
import { prisma } from "@/lib/db/prisma";
import { todayIn, type LocalDate } from "@/lib/dates";
import { isEnabled } from "@/lib/flags";
import { syncAllForUser } from "@/lib/sync/service";
import { detectAndPersistRecurring } from "@/lib/recurring/service";
import { reconcileBillPayments, sendBillReminders } from "@/lib/bills/service";
import { sendSubscriptionReminders } from "@/lib/subscriptions/service";
import { checkBudgetAlerts } from "@/lib/budget/service";
import { checkGoalDeadlines } from "@/lib/goals/service";
import { runScheduledAutomations } from "@/lib/automation/engine";
import { recordNetWorthSnapshot } from "@/lib/networth/service";

/**
 * Daily background work, run by `npm run jobs:daily` or the protected
 * /api/cron/daily route (Vercel Cron). Every step is idempotent (dedupe keys,
 * upserts, automation run keys), so running twice on the same day is harmless.
 * A failing step is recorded and the remaining steps still run.
 */
export const DAILY_STEPS = [
  "sync",
  "recurring",
  "bills",
  "reminders",
  "budgets",
  "goals",
  "automations",
  "netWorth",
] as const;

export type DailyStep = (typeof DAILY_STEPS)[number];

export interface StepResult {
  step: DailyStep;
  ok: boolean;
  skipped?: boolean;
  detail?: string;
}

export interface UserJobResult {
  userId: string;
  today: LocalDate;
  steps: StepResult[];
}

async function runStep(step: DailyStep, fn: () => Promise<string | void>): Promise<StepResult> {
  try {
    const detail = await fn();
    return { step, ok: true, detail: detail || undefined };
  } catch (error) {
    console.error(`[jobs] ${step} failed:`, error instanceof Error ? error.message : "unknown error");
    return { step, ok: false, detail: "Step failed; see server logs." };
  }
}

export async function runDailyJobsForUser(userId: string, opts: { now?: Date; steps?: DailyStep[] } = {}): Promise<UserJobResult> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, timeZone: true } });
  const today = todayIn(user.timeZone, opts.now);
  const wanted = new Set(opts.steps ?? DAILY_STEPS);
  const steps: StepResult[] = [];
  const skip = (step: DailyStep, detail: string) => steps.push({ step, ok: true, skipped: true, detail });

  for (const step of DAILY_STEPS) {
    if (!wanted.has(step)) continue;
    switch (step) {
      case "sync":
        if (!isEnabled("ENABLE_BANKING")) skip(step, "Bank connections are disabled.");
        else
          steps.push(
            await runStep(step, async () => {
              const results = await syncAllForUser(userId, "scheduled");
              const failed = results.filter((r) => r.status === "FAILED").length;
              return `${results.length} connection(s) synced, ${failed} failed`;
            }),
          );
        break;
      case "recurring":
        steps.push(await runStep(step, async () => void (await detectAndPersistRecurring(userId, { today }))));
        break;
      case "bills":
        steps.push(await runStep(step, async () => `${await reconcileBillPayments(userId, today)} bill payment(s) matched`));
        break;
      case "reminders":
        steps.push(
          await runStep(step, async () => {
            await sendBillReminders(userId, today);
            await sendSubscriptionReminders(userId, today);
          }),
        );
        break;
      case "budgets":
        steps.push(await runStep(step, () => checkBudgetAlerts(userId, today)));
        break;
      case "goals":
        steps.push(await runStep(step, () => checkGoalDeadlines(userId, today)));
        break;
      case "automations":
        if (!isEnabled("ENABLE_AUTOMATIONS")) skip(step, "Automations are disabled.");
        else steps.push(await runStep(step, async () => `${(await runScheduledAutomations(userId, today)).executed} automation(s) ran`));
        break;
      case "netWorth":
        steps.push(await runStep(step, async () => void (await recordNetWorthSnapshot(userId, today))));
        break;
    }
  }
  return { userId, today, steps };
}

let running = false;

/** Runs the daily jobs for every user, in small batches. Returns a compact summary. */
export async function runDailyJobs(opts: { now?: Date; batchSize?: number } = {}) {
  if (running) return { skipped: true as const, users: 0, failedSteps: 0 };
  running = true;
  const started = Date.now();
  let users = 0;
  let failedSteps = 0;
  try {
    const batchSize = opts.batchSize ?? 50;
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.user.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (!batch.length) break;
      for (const u of batch) {
        const result = await runDailyJobsForUser(u.id, { now: opts.now });
        users++;
        failedSteps += result.steps.filter((s) => !s.ok).length;
      }
      cursor = batch[batch.length - 1].id;
    }
  } finally {
    running = false;
  }
  return { skipped: false as const, users, failedSteps, durationMs: Date.now() - started };
}
