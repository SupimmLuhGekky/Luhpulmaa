import "server-only";
import { prisma } from "@/lib/db/prisma";
import { addDays, daysBetween, fromDbDate, todayIn, toDbDate, type LocalDate } from "@/lib/dates";
import { toCents } from "@/lib/finance/money";
import { FREQUENCY_LABELS } from "@/lib/dates/schedule";
import { runSubscriptionDetectedAutomations } from "@/lib/automation/engine";
import { notify } from "@/lib/notifications/service";
import { userPreferences } from "@/lib/settings/preferences";
import { notificationFormat } from "@/lib/notifications/format";
import { detectRecurring, incomeSourceSyncData, keepSubscriptionChoice, type DetectedSeries } from "./detect";

const BILL_CATEGORY_KEYS = new Set(["housing", "utilities", "insurance", "education"]);

/**
 * Detects recurring series from the last ~13 months of transactions and persists them:
 *  - RecurringTransaction rows (user-dismissed series are left alone)
 *  - transactions flagged isRecurring and linked to their series
 *  - subscriptions for subscription-like outflows (once per series)
 *  - bills for housing/utility/insurance series (once per series)
 *  - income sources for recurring inflows categorised as income (payday detection)
 * Idempotent: running it again updates the same rows.
 */
export async function detectAndPersistRecurring(userId: string, opts: { today?: LocalDate } = {}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const today = opts.today ?? todayIn(user.timeZone);
  const since = addDays(today, -400);
  const txns = await prisma.transaction.findMany({
    where: { userId, date: { gte: toDbDate(since) }, isExcluded: false, isPending: false },
    select: { id: true, date: true, amountCents: true, merchantName: true, description: true, accountId: true, categoryId: true, isTransfer: true, merchantId: true },
  });
  const categories = await prisma.category.findMany({ where: { userId }, select: { id: true, systemKey: true, kind: true } });
  const catById = new Map(categories.map((c) => [c.id, c]));
  const subscriptionsCat = categories.find((c) => c.systemKey === "subscriptions");
  const merchantByTxn = new Map(txns.map((t) => [t.id, t.merchantId]));

  const series = detectRecurring(
    txns.map((t) => ({ ...t, date: fromDbDate(t.date), amountCents: toCents(t.amountCents) })),
    today,
  );

  const stats = { series: 0, subscriptionsCreated: 0, billsCreated: 0, incomeSources: 0 };
  for (const s of series) {
    const existing = await prisma.recurringTransaction.findUnique({ where: { userId_seriesKey_direction: { userId, seriesKey: s.seriesKey, direction: s.direction } } });
    if (existing?.status === "DISMISSED") continue;
    const cat = s.categoryId ? catById.get(s.categoryId) : undefined;
    // Housing, utility, insurance and tuition series are bills even when their amount is fixed.
    const isBillCategory = Boolean(cat?.systemKey && BILL_CATEGORY_KEYS.has(cat.systemKey));
    const looksLikeSubscription = !isBillCategory && (s.isSubscriptionLike || (s.direction === "OUTFLOW" && cat?.id === subscriptionsCat?.id));
    const isSubscription = keepSubscriptionChoice(existing, looksLikeSubscription);
    const merchantId = merchantByTxn.get(s.transactionIds[0]) ?? null;
    const data = {
      name: s.name,
      frequency: s.frequency,
      averageAmountCents: s.averageAmountCents,
      lastAmountCents: s.lastAmountCents,
      lastDate: toDbDate(s.lastDate),
      nextExpectedDate: toDbDate(s.nextExpectedDate),
      occurrenceCount: s.occurrenceCount,
      confidence: s.confidence,
      isSubscription,
      accountId: s.accountId,
      categoryId: s.categoryId,
      merchantId,
    };
    const rec = existing
      ? await prisma.recurringTransaction.update({ where: { id: existing.id }, data })
      : await prisma.recurringTransaction.create({ data: { userId, seriesKey: s.seriesKey, direction: s.direction, status: s.confidence >= 80 ? "CONFIRMED" : "SUGGESTED", ...data } });
    stats.series++;
    await prisma.transaction.updateMany({ where: { userId, id: { in: s.transactionIds } }, data: { isRecurring: true, recurringId: rec.id } });

    if (s.direction === "OUTFLOW" && isSubscription) {
      if (await ensureSubscription(userId, rec.id, s, merchantId)) stats.subscriptionsCreated++;
    } else if (s.direction === "OUTFLOW" && isBillCategory) {
      if (await ensureBill(userId, rec.id, s)) stats.billsCreated++;
    } else if (s.direction === "INFLOW" && cat?.kind === "INCOME" && isPaycheque(s)) {
      await upsertIncomeSource(userId, s, today);
      stats.incomeSources++;
    }
  }
  return stats;
}

/** Payday detection: regular pay-like inflows, not interest, cashback or refunds. */
function isPaycheque(s: DetectedSeries) {
  return (
    ["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY"].includes(s.frequency) &&
    s.averageAmountCents >= 20_000 &&
    !/interest|interet|dividend|cashback|refund|rembours|reward/i.test(`${s.seriesKey} ${s.name}`)
  );
}

async function ensureSubscription(userId: string, recurringId: string, s: DetectedSeries, merchantId: string | null) {
  const existing = await prisma.subscription.findFirst({ where: { userId, OR: [{ recurringId }, ...(merchantId ? [{ merchantId }] : [])] } });
  if (existing) {
    if (existing.isDetected && existing.status === "ACTIVE") {
      await prisma.subscription.update({ where: { id: existing.id }, data: { amountCents: -s.lastAmountCents, nextChargeDate: toDbDate(s.nextExpectedDate), recurringId } });
    }
    return false;
  }
  const sub = await prisma.subscription.create({
    data: {
      userId,
      name: s.name,
      merchantId,
      recurringId,
      categoryId: s.categoryId,
      accountId: s.accountId,
      amountCents: -s.lastAmountCents,
      frequency: s.frequency,
      nextChargeDate: toDbDate(s.nextExpectedDate),
      isDetected: true,
      reminderDaysBefore: 2,
    },
  });
  const f = await notificationFormat(userId);
  await notify(userId, {
    type: "SUBSCRIPTION",
    title: `Subscription detected: ${s.name}`,
    body: `${f.money(-s.lastAmountCents)} ${FREQUENCY_LABELS[s.frequency].toLowerCase()}. Next charge expected ${f.date(s.nextExpectedDate)}.`,
    href: "/subscriptions",
    dedupeKey: `subscription:detected:${recurringId}`,
  });
  await runSubscriptionDetectedAutomations(userId, { id: sub.id, name: sub.name, amountCents: -s.lastAmountCents });
  return true;
}

async function ensureBill(userId: string, recurringId: string, s: DetectedSeries) {
  const existing = await prisma.bill.findFirst({ where: { userId, recurringId } });
  if (existing) return false;
  await prisma.bill.create({
    data: {
      userId,
      name: s.name,
      amountCents: Math.abs(s.averageAmountCents),
      isVariableAmount: s.averageAmountCents !== s.lastAmountCents,
      anchorDate: toDbDate(s.nextExpectedDate),
      frequency: s.frequency === "SEMI_MONTHLY" ? "MONTHLY" : s.frequency,
      categoryId: s.categoryId,
      accountId: s.accountId,
      recurringId,
      autopay: true,
      reminderDaysBefore: (await userPreferences(userId)).billReminderDays,
      notes: "Detected from your transactions",
    },
  });
  return true;
}

async function upsertIncomeSource(userId: string, s: DetectedSeries, today: LocalDate) {
  const existing = await prisma.incomeSource.findFirst({ where: { userId, matchPattern: s.seriesKey } });
  const lastPaid = existing?.lastPaidDate ? fromDbDate(existing.lastPaidDate) : null;
  if (existing) {
    // A source the user edited keeps their values: only the last payday is recorded.
    const { lastPaidDate, nextExpectedDate, ...rest } = incomeSourceSyncData(existing, s);
    await prisma.incomeSource.update({
      where: { id: existing.id },
      data: { ...rest, lastPaidDate: toDbDate(lastPaidDate), ...(nextExpectedDate ? { nextExpectedDate: toDbDate(nextExpectedDate) } : {}) },
    });
  } else {
    const hasPrimary = await prisma.incomeSource.count({ where: { userId, isPrimary: true } });
    await prisma.incomeSource.create({
      data: {
        userId,
        name: s.name,
        matchPattern: s.seriesKey,
        frequency: s.frequency,
        isDetected: true,
        isPrimary: hasPrimary === 0,
        averageAmountCents: s.averageAmountCents,
        lastPaidDate: toDbDate(s.lastDate),
        nextExpectedDate: toDbDate(s.nextExpectedDate),
        accountId: s.accountId,
        ...(s.semiMonthlyDays ? { semiMonthlyDays: s.semiMonthlyDays } : {}),
      },
    });
  }
  if (lastPaid !== s.lastDate && daysBetween(s.lastDate, today) <= 3) {
    const f = await notificationFormat(userId);
    await notify(userId, {
      type: "PAYDAY",
      severity: "SUCCESS",
      title: `Payday: ${f.money(s.lastAmountCents)} from ${s.name}`,
      body: `Next paycheque expected around ${f.date(s.nextExpectedDate)} (estimate).`,
      href: "/income",
      dedupeKey: `payday:${s.seriesKey}:${s.lastDate}`,
    });
  }
}

export async function listRecurring(userId: string) {
  const rows = await prisma.recurringTransaction.findMany({
    where: { userId, status: { not: "DISMISSED" } },
    include: { category: { select: { id: true, name: true, icon: true, color: true } }, account: { select: { id: true, name: true } } },
    orderBy: { nextExpectedDate: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    direction: r.direction,
    frequency: r.frequency,
    averageAmountCents: toCents(r.averageAmountCents),
    lastAmountCents: toCents(r.lastAmountCents),
    lastDate: fromDbDate(r.lastDate),
    nextExpectedDate: fromDbDate(r.nextExpectedDate),
    occurrenceCount: r.occurrenceCount,
    confidence: r.confidence,
    status: r.status,
    isSubscription: r.isSubscription,
    category: r.category,
    account: r.account,
  }));
}

export async function setRecurringStatus(userId: string, id: string, status: "CONFIRMED" | "DISMISSED") {
  const { count } = await prisma.recurringTransaction.updateMany({ where: { id, userId }, data: { status } });
  if (count && status === "DISMISSED") {
    await prisma.transaction.updateMany({ where: { userId, recurringId: id }, data: { isRecurring: false } });
  }
  return count > 0;
}
