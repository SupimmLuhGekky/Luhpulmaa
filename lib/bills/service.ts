import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AppError, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { addDays, daysBetween, fromDbDate, toDbDate, type LocalDate } from "@/lib/dates";
import { nextOccurrence, occurrencesBetween } from "@/lib/dates/schedule";
import { formatCurrency, toCents, type Cents } from "@/lib/finance/money";
import { expectedPaydays } from "@/lib/income/service";
import { notify } from "@/lib/notifications/service";
import { paydayWindow } from "./calendar";

export const BILL_FREQUENCIES = ["ONE_TIME", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

export const billInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  amountCents: z.number().int().positive().max(100_000_000),
  isVariableAmount: z.boolean().default(false),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  frequency: z.enum(BILL_FREQUENCIES).default("MONTHLY"),
  categoryId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  autopay: z.boolean().default(false),
  reminderDaysBefore: z.number().int().min(0).max(30).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

export interface BillOccurrence {
  billId: string;
  name: string;
  dueDate: LocalDate;
  amountCents: Cents;
  isVariableAmount: boolean;
  autopay: boolean;
  paid: boolean;
  paidAt: string | null;
  category: { id: string; name: string; icon: string; color: string } | null;
  account: { id: string; name: string } | null;
  frequency: string;
}

/** Expands every active bill into dated occurrences in [from, to] with paid/unpaid status. */
export async function billOccurrences(userId: string, from: LocalDate, to: LocalDate): Promise<BillOccurrence[]> {
  const bills = await prisma.bill.findMany({
    where: { userId, isActive: true },
    include: {
      category: { select: { id: true, name: true, icon: true, color: true } },
      account: { select: { id: true, name: true } },
      payments: { where: { dueDate: { gte: toDbDate(from), lte: toDbDate(to) } } },
    },
  });
  const out: BillOccurrence[] = [];
  for (const b of bills) {
    const paid = new Map(b.payments.map((p) => [fromDbDate(p.dueDate), p]));
    for (const d of occurrencesBetween(fromDbDate(b.anchorDate), b.frequency, from, to, { endDate: fromDbDate(b.endDate) })) {
      const p = paid.get(d);
      out.push({
        billId: b.id,
        name: b.name,
        dueDate: d,
        amountCents: p ? toCents(p.amountCents) : toCents(b.amountCents),
        isVariableAmount: b.isVariableAmount,
        autopay: b.autopay,
        paid: Boolean(p),
        paidAt: p ? p.paidAt.toISOString() : null,
        category: b.category,
        account: b.account,
        frequency: b.frequency,
      });
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.name.localeCompare(b.name)));
}

/** All bills (active first). With `today`, each row also gets its next due date on or after today. */
export async function listBills(userId: string, today?: LocalDate) {
  const bills = await prisma.bill.findMany({
    where: { userId },
    include: { category: { select: { id: true, name: true, icon: true, color: true } }, account: { select: { id: true, name: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return bills.map((b) => ({
    id: b.id,
    name: b.name,
    amountCents: toCents(b.amountCents),
    isVariableAmount: b.isVariableAmount,
    anchorDate: fromDbDate(b.anchorDate),
    frequency: b.frequency,
    autopay: b.autopay,
    reminderDaysBefore: b.reminderDaysBefore,
    notes: b.notes,
    isActive: b.isActive,
    recurringId: b.recurringId,
    nextDueDate: today && b.isActive ? nextOccurrence(fromDbDate(b.anchorDate), b.frequency, today, { endDate: fromDbDate(b.endDate) }) : null,
    category: b.category,
    account: b.account,
  }));
}

/** How far back unpaid occurrences count as "overdue" in summaries. */
export const OVERDUE_LOOKBACK_DAYS = 60;

/**
 * Money the user's bills need before the next expected payday: unpaid bill
 * occurrences from today until the day before that payday (the same window
 * safe-to-spend uses), plus unpaid overdue occurrences and subscriptions charged in
 * the same window, reported separately. Paydays are estimates from income sources.
 */
export async function billsBeforePayday(userId: string, today: LocalDate) {
  const paydays = await expectedPaydays(userId, addDays(today, 1), addDays(today, 45));
  const next = paydays[0] ?? null;
  const window = paydayWindow(today, next?.date ?? null);
  const [due, overdue, subs, billSeries] = await Promise.all([
    billOccurrences(userId, window.from, window.to),
    billOccurrences(userId, addDays(today, -OVERDUE_LOOKBACK_DAYS), addDays(today, -1)),
    prisma.subscription.findMany({ where: { userId, status: "ACTIVE", nextChargeDate: { not: null } }, select: { name: true, amountCents: true, frequency: true, nextChargeDate: true, recurringId: true } }),
    prisma.bill.findMany({ where: { userId, recurringId: { not: null } }, select: { recurringId: true } }),
  ]);
  const bills = due.filter((o) => !o.paid);
  const overdueBills = overdue.filter((o) => !o.paid);
  // Subscriptions that are also tracked as bills (same recurring series) are counted once, as bills.
  const billRecurring = new Set(billSeries.map((b) => b.recurringId));
  const subscriptions: { name: string; date: LocalDate; amountCents: Cents }[] = [];
  for (const s of subs) {
    if (s.recurringId && billRecurring.has(s.recurringId)) continue;
    for (const d of occurrencesBetween(fromDbDate(s.nextChargeDate)!, s.frequency, window.from, window.to)) subscriptions.push({ name: s.name, date: d, amountCents: toCents(s.amountCents) });
  }
  subscriptions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
  const sum = (xs: { amountCents: Cents }[]) => xs.reduce((acc, x) => acc + x.amountCents, 0);
  return {
    today,
    nextPayday: next ? { date: next.date, amountCents: next.amount, name: next.name } : null,
    windowEnd: window.to,
    bills,
    total: sum(bills),
    overdue: overdueBills,
    overdueTotal: sum(overdueBills),
    subscriptions,
    subscriptionsTotal: sum(subscriptions),
  };
}

export type BillsBeforePayday = Awaited<ReturnType<typeof billsBeforePayday>>;

async function assertRefs(userId: string, input: { categoryId?: string | null; accountId?: string | null }) {
  if (input.categoryId && !(await prisma.category.count({ where: { id: input.categoryId, userId } }))) throw notFound("Category");
  if (input.accountId && !(await prisma.account.count({ where: { id: input.accountId, userId } }))) throw notFound("Account");
}

export async function createBill(userId: string, input: z.infer<typeof billInputSchema>) {
  await assertRefs(userId, input);
  const bill = await prisma.bill.create({
    data: {
      userId,
      name: input.name,
      amountCents: input.amountCents,
      isVariableAmount: input.isVariableAmount,
      anchorDate: toDbDate(input.dueDate),
      frequency: input.frequency,
      categoryId: input.categoryId ?? null,
      accountId: input.accountId ?? null,
      autopay: input.autopay,
      reminderDaysBefore: input.reminderDaysBefore ?? 3,
      notes: input.notes ?? null,
    },
  });
  await audit(userId, "bill.changed", { type: "bill", id: bill.id }, { created: true });
  return bill;
}

export async function updateBill(userId: string, id: string, input: Partial<z.infer<typeof billInputSchema>> & { isActive?: boolean }) {
  const existing = await prisma.bill.findFirst({ where: { id, userId } });
  if (!existing) throw notFound("Bill");
  await assertRefs(userId, input);
  const bill = await prisma.bill.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
      ...(input.isVariableAmount !== undefined ? { isVariableAmount: input.isVariableAmount } : {}),
      ...(input.dueDate !== undefined ? { anchorDate: toDbDate(input.dueDate) } : {}),
      ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.autopay !== undefined ? { autopay: input.autopay } : {}),
      ...(input.reminderDaysBefore !== undefined ? { reminderDaysBefore: input.reminderDaysBefore } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  await audit(userId, "bill.changed", { type: "bill", id });
  return bill;
}

export async function deleteBill(userId: string, id: string) {
  const { count } = await prisma.bill.deleteMany({ where: { id, userId } });
  if (!count) throw notFound("Bill");
  await audit(userId, "bill.changed", { type: "bill", id }, { deleted: true });
}

/** Records (or clears) the user's note that one occurrence was paid. No money moves. */
export async function setBillPaid(userId: string, billId: string, dueDate: LocalDate, paid: boolean, amountCents?: number) {
  const bill = await prisma.bill.findFirst({ where: { id: billId, userId } });
  if (!bill) throw notFound("Bill");
  if (paid) {
    const isDueDate = occurrencesBetween(fromDbDate(bill.anchorDate), bill.frequency, dueDate, dueDate, { endDate: fromDbDate(bill.endDate) }).length > 0;
    if (!isDueDate) throw new AppError("VALIDATION_FAILED", "That date isn't one of this bill's due dates.");
    await prisma.billPayment.upsert({
      where: { billId_dueDate: { billId, dueDate: toDbDate(dueDate) } },
      update: { amountCents: amountCents ?? bill.amountCents, paidAt: new Date() },
      create: { userId, billId, dueDate: toDbDate(dueDate), amountCents: amountCents ?? bill.amountCents },
    });
  } else {
    await prisma.billPayment.deleteMany({ where: { billId, dueDate: toDbDate(dueDate), userId } });
  }
}

/**
 * Marks bill occurrences paid when a matching outflow exists (same recurring series or
 * similar amount within ±5 days of the due date). Keeps paid/unpaid honest without
 * the user having to tick boxes.
 */
export async function reconcileBillPayments(userId: string, today: LocalDate) {
  const from = addDays(today, -45);
  const occ = (await billOccurrences(userId, from, today)).filter((o) => !o.paid);
  if (!occ.length) return 0;
  const bills = await prisma.bill.findMany({ where: { userId, id: { in: [...new Set(occ.map((o) => o.billId))] } }, select: { id: true, recurringId: true, name: true } });
  const txns = await prisma.transaction.findMany({
    where: { userId, date: { gte: toDbDate(addDays(from, -5)), lte: toDbDate(today) }, amountCents: { lt: 0 } },
    select: { id: true, date: true, amountCents: true, recurringId: true, merchantName: true },
  });
  let matched = 0;
  for (const o of occ) {
    const b = bills.find((x) => x.id === o.billId);
    const candidate = txns.find((t) => {
      const d = fromDbDate(t.date);
      if (Math.abs(daysBetween(d, o.dueDate)) > 5) return false;
      if (b?.recurringId && t.recurringId === b.recurringId) return true;
      const amt = -toCents(t.amountCents);
      return Math.abs(amt - o.amountCents) * 100 <= o.amountCents * (o.isVariableAmount ? 40 : 2) && (t.merchantName ?? "").toLowerCase().includes(o.name.toLowerCase().split(" ")[0]);
    });
    if (candidate) {
      await prisma.billPayment.upsert({
        where: { billId_dueDate: { billId: o.billId, dueDate: toDbDate(o.dueDate) } },
        update: {},
        create: { userId, billId: o.billId, dueDate: toDbDate(o.dueDate), amountCents: -toCents(candidate.amountCents), transactionId: candidate.id },
      });
      matched++;
    }
  }
  return matched;
}

/** Sends reminders for unpaid bills due within each bill's reminder window. */
export async function sendBillReminders(userId: string, today: LocalDate) {
  const upcoming = (await billOccurrences(userId, today, addDays(today, 30))).filter((o) => !o.paid);
  const bills = await prisma.bill.findMany({ where: { userId, id: { in: upcoming.map((o) => o.billId) } }, select: { id: true, reminderDaysBefore: true } });
  const reminder = new Map(bills.map((b) => [b.id, b.reminderDaysBefore]));
  for (const o of upcoming) {
    const days = daysBetween(today, o.dueDate);
    const window = reminder.get(o.billId);
    if (window === null || window === undefined || days > window) continue;
    await notify(userId, {
      type: "UPCOMING_BILL",
      severity: days <= 1 ? "WARNING" : "INFO",
      title: days === 0 ? `${o.name} is due today` : `${o.name} is due in ${days} day${days === 1 ? "" : "s"}`,
      body: `${formatCurrency(o.amountCents)}${o.isVariableAmount ? " (estimated)" : ""} due ${o.dueDate}${o.autopay ? " — set to autopay" : ""}.`,
      href: "/bills",
      dedupeKey: `bill:${o.billId}:${o.dueDate}`,
    });
  }
}
