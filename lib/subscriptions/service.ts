import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { addDays, daysBetween, fromDbDate, toDbDate, type LocalDate } from "@/lib/dates";
import { nextOccurrence } from "@/lib/dates/schedule";
import { monthlyEquivalent, yearlyEquivalent } from "@/lib/finance/frequency";
import { formatCurrency, toCents } from "@/lib/finance/money";
import { notify } from "@/lib/notifications/service";

export const subscriptionInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  amountCents: z.number().int().positive().max(10_000_000),
  frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]).default("MONTHLY"),
  nextChargeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  reminderDaysBefore: z.number().int().min(0).max(30).nullable().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]).default("ACTIVE"),
  notes: z.string().trim().max(300).nullable().optional(),
});

export async function listSubscriptions(userId: string, today: LocalDate) {
  const subs = await prisma.subscription.findMany({
    where: { userId },
    include: { category: { select: { id: true, name: true, icon: true, color: true } }, account: { select: { id: true, name: true } } },
    orderBy: [{ status: "asc" }, { nextChargeDate: "asc" }],
  });
  const rows = subs.map((s) => {
    const amount = toCents(s.amountCents);
    let next = fromDbDate(s.nextChargeDate);
    if (next && next < today && s.status === "ACTIVE") next = nextOccurrence(next, s.frequency, today);
    return {
      id: s.id,
      name: s.name,
      amountCents: amount,
      currency: s.currency,
      frequency: s.frequency,
      nextChargeDate: next,
      reminderDaysBefore: s.reminderDaysBefore,
      status: s.status,
      isDetected: s.isDetected,
      notes: s.notes,
      category: s.category,
      account: s.account,
      monthlyCents: monthlyEquivalent(amount, s.frequency),
      yearlyCents: yearlyEquivalent(amount, s.frequency),
    };
  });
  const active = rows.filter((r) => r.status === "ACTIVE");
  return {
    rows,
    totals: { monthly: active.reduce((a, r) => a + r.monthlyCents, 0), yearly: active.reduce((a, r) => a + r.yearlyCents, 0), count: active.length },
  };
}

async function assertRefs(userId: string, input: { categoryId?: string | null; accountId?: string | null }) {
  if (input.categoryId && !(await prisma.category.count({ where: { id: input.categoryId, userId } }))) throw notFound("Category");
  if (input.accountId && !(await prisma.account.count({ where: { id: input.accountId, userId } }))) throw notFound("Account");
}

export async function createSubscription(userId: string, input: z.infer<typeof subscriptionInputSchema>) {
  await assertRefs(userId, input);
  const sub = await prisma.subscription.create({
    data: { userId, ...input, nextChargeDate: input.nextChargeDate ? toDbDate(input.nextChargeDate) : null, isDetected: false },
  });
  await audit(userId, "subscription.changed", { type: "subscription", id: sub.id }, { created: true });
  return sub;
}

export async function updateSubscription(userId: string, id: string, input: Partial<z.infer<typeof subscriptionInputSchema>>) {
  const existing = await prisma.subscription.findFirst({ where: { id, userId } });
  if (!existing) throw notFound("Subscription");
  await assertRefs(userId, input);
  const { nextChargeDate, ...rest } = input;
  const sub = await prisma.subscription.update({
    where: { id },
    data: { ...rest, ...(nextChargeDate !== undefined ? { nextChargeDate: nextChargeDate ? toDbDate(nextChargeDate) : null } : {}) },
  });
  await audit(userId, "subscription.changed", { type: "subscription", id });
  return sub;
}

export async function deleteSubscription(userId: string, id: string) {
  const sub = await prisma.subscription.findFirst({ where: { id, userId } });
  if (!sub) throw notFound("Subscription");
  await prisma.subscription.delete({ where: { id } });
  // Stop re-detecting a series the user removed.
  if (sub.recurringId) await prisma.recurringTransaction.updateMany({ where: { id: sub.recurringId, userId }, data: { status: "DISMISSED" } });
  await audit(userId, "subscription.changed", { type: "subscription", id }, { deleted: true });
}

/** Marks a detected recurring series as a subscription (from the Recurring list). */
export async function subscriptionFromRecurring(userId: string, recurringId: string) {
  const rec = await prisma.recurringTransaction.findFirst({ where: { id: recurringId, userId } });
  if (!rec) throw notFound("Recurring series");
  await prisma.recurringTransaction.update({ where: { id: rec.id }, data: { isSubscription: true, status: "CONFIRMED" } });
  const existing = await prisma.subscription.findFirst({ where: { userId, recurringId } });
  if (existing) return existing;
  return prisma.subscription.create({
    data: {
      userId,
      name: rec.name,
      merchantId: rec.merchantId,
      recurringId,
      categoryId: rec.categoryId,
      accountId: rec.accountId,
      amountCents: -toCents(rec.lastAmountCents),
      frequency: rec.frequency,
      nextChargeDate: rec.nextExpectedDate,
      isDetected: true,
    },
  });
}

export async function sendSubscriptionReminders(userId: string, today: LocalDate) {
  const subs = await prisma.subscription.findMany({ where: { userId, status: "ACTIVE", reminderDaysBefore: { not: null }, nextChargeDate: { gte: toDbDate(today), lte: toDbDate(addDays(today, 30)) } } });
  for (const s of subs) {
    const next = fromDbDate(s.nextChargeDate)!;
    const days = daysBetween(today, next);
    if (days > (s.reminderDaysBefore ?? 0)) continue;
    await notify(userId, {
      type: "SUBSCRIPTION",
      title: `${s.name} renews ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`,
      body: `${formatCurrency(toCents(s.amountCents))} will be charged on ${next}.`,
      href: "/subscriptions",
      dedupeKey: `subscription:reminder:${s.id}:${next}`,
    });
  }
}
