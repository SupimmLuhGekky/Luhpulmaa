import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { fromDbDate, monthKey, todayIn } from "@/lib/dates";
import { centsToDecimalString, toCents } from "@/lib/finance/money";
import { calculateGoalProgress } from "@/lib/finance/calculations";
import { budgetView, findBudget } from "@/lib/budget/service";
import { analytics } from "@/lib/analytics/service";
import { listSubscriptions } from "@/lib/subscriptions/service";
import { listBills } from "@/lib/bills/service";
import { audit } from "@/lib/audit";
import { toCsv } from "./csv";
import { exportFileName, type ExportType } from "./files";
import { createZip } from "./zip";

export const exportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accountId: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const amount = (c: bigint | number) => centsToDecimalString(toCents(c));

export async function transactionsCsv(userId: string, q: z.infer<typeof exportQuerySchema>) {
  const accountIds = q.accountId ? (Array.isArray(q.accountId) ? q.accountId : [q.accountId]) : undefined;
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      ...(accountIds ? { accountId: { in: accountIds } } : {}),
      ...(q.from || q.to ? { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    },
    select: {
      id: true,
      date: true,
      postedDate: true,
      merchantName: true,
      description: true,
      amountCents: true,
      currency: true,
      type: true,
      notes: true,
      isPending: true,
      isRecurring: true,
      isTransfer: true,
      isExcluded: true,
      account: { select: { name: true } },
      category: { select: { name: true } },
      subcategory: { select: { name: true } },
      tags: { select: { tag: { select: { name: true } } } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return toCsv(
    ["Date", "Posted date", "Account", "Merchant", "Description", "Amount", "Currency", "Type", "Category", "Subcategory", "Tags", "Notes", "Pending", "Recurring", "Transfer", "Excluded", "ID"],
    rows.map((t) => [
      fromDbDate(t.date),
      fromDbDate(t.postedDate) ?? "",
      t.account.name,
      t.merchantName,
      t.description,
      amount(t.amountCents),
      t.currency,
      t.type.toLowerCase(),
      t.category?.name ?? "",
      t.subcategory?.name ?? "",
      t.tags.map((x) => x.tag.name).join("; "),
      t.notes,
      t.isPending,
      t.isRecurring,
      t.isTransfer,
      t.isExcluded,
      t.id,
    ]),
  );
}

export async function budgetCsv(userId: string, month: string) {
  const budget = await findBudget(userId, "MONTHLY", `${month}-01`);
  if (!budget) return toCsv(["Category", "Budgeted", "Rollover", "Available", "Spent", "Remaining", "Used %"], []);
  const view = await budgetView(userId, budget.id);
  return toCsv(
    ["Category", "Budgeted", "Rollover", "Available", "Spent", "Remaining", "Used %"],
    [
      ...view.lines.map((l) => [l.name, amount(l.budgeted), amount(l.rollover), amount(l.available), amount(l.spent), amount(l.remaining), (l.usedBps / 100).toFixed(1)]),
      ...view.unbudgeted.map((u) => [`${u.name} (not budgeted)`, "0.00", "0.00", "0.00", amount(u.spent), amount(-u.spent), ""]),
    ],
  );
}

export async function goalsCsv(userId: string, timeZone: string) {
  const today = todayIn(timeZone);
  const goals = await prisma.goal.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const contributions = await prisma.goalContribution.findMany({ where: { userId }, include: { goal: { select: { name: true } } }, orderBy: { date: "asc" } });
  const goalsCsvText = toCsv(
    ["Goal", "Target", "Current", "Remaining", "Progress %", "Deadline", "Required monthly", "Priority", "Status"],
    goals.map((g) => {
      const p = calculateGoalProgress(toCents(g.targetCents), toCents(g.currentCents), fromDbDate(g.deadline), today);
      return [g.name, amount(p.target), amount(p.current), amount(p.remaining), (p.progressBps / 100).toFixed(1), fromDbDate(g.deadline) ?? "", p.requiredMonthly === null ? "" : amount(p.requiredMonthly), g.priority.toLowerCase(), g.status.toLowerCase()];
    }),
  );
  const contributionsCsv = toCsv(
    ["Date", "Goal", "Amount", "Kind", "Source", "Note"],
    contributions.map((c) => [fromDbDate(c.date), c.goal.name, amount(c.amountCents), c.kind === "PLANNED_ALLOCATION" ? "planned allocation" : c.kind === "USER_REPORTED_TRANSFER" ? "transfer reported by you" : "verified transfer", c.source.toLowerCase(), c.note]),
  );
  return { goalsCsvText, contributionsCsv };
}

export async function summaryCsv(userId: string) {
  const a = await analytics(userId, { range: "year" });
  const rows: (string | number)[][] = [
    ["Period", `${a.range.from} to ${a.range.to}`],
    ["Income", amount(a.metrics.income)],
    ["Spending", amount(a.metrics.spending)],
    ["Net savings", amount(a.metrics.savings)],
    ["Savings rate %", (a.metrics.savingsRateBps / 100).toFixed(1)],
    ["Average monthly spending", amount(a.metrics.averageMonthlySpending)],
    ["Recurring expenses per month (est.)", amount(a.metrics.recurringMonthly)],
    ["Subscriptions per month", amount(a.metrics.subscriptionsMonthly)],
    ["Net worth", amount(a.metrics.netWorth)],
    [],
    ["Month", "Income", "Spending"],
    ...a.monthly.map((m) => [m.period, amount(m.income), amount(m.spending)]),
    [],
    ["Category", "Spending this year"],
    ...a.categoryBreakdown.map((c) => [c.name, amount(c.spending)]),
  ];
  return toCsv(["Financial summary", ""], rows);
}

export async function accountsCsv(userId: string) {
  const accounts = await prisma.account.findMany({ where: { userId }, include: { institution: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  return toCsv(
    ["Account", "Institution", "Type", "Currency", "Current balance", "Available balance", "Credit limit", "Manual", "Hidden", "Status"],
    accounts.map((a) => [a.name, a.institution?.name ?? "", a.type.toLowerCase(), a.currency, amount(a.currentBalanceCents), a.availableBalanceCents === null ? "" : amount(a.availableBalanceCents), a.creditLimitCents === null ? "" : amount(a.creditLimitCents), a.isManual, a.isHidden, a.status.toLowerCase()]),
  );
}

/** Complete dataset as a ZIP of CSV files. */
export async function fullExportZip(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const today = todayIn(user.timeZone);
  const [transactions, accounts, goals, summary, budget, subs, bills] = await Promise.all([
    transactionsCsv(userId, {}),
    accountsCsv(userId),
    goalsCsv(userId, user.timeZone),
    summaryCsv(userId),
    budgetCsv(userId, monthKey(today)),
    listSubscriptions(userId, today),
    listBills(userId),
  ]);
  const subsCsv = toCsv(["Subscription", "Amount", "Frequency", "Monthly", "Yearly", "Next charge", "Status"], subs.rows.map((s) => [s.name, amount(s.amountCents), s.frequency.toLowerCase(), amount(s.monthlyCents), amount(s.yearlyCents), s.nextChargeDate ?? "", s.status.toLowerCase()]));
  const billsCsv = toCsv(["Bill", "Amount", "Frequency", "First due", "Autopay", "Active"], bills.map((b) => [b.name, amount(b.amountCents), b.frequency.toLowerCase(), b.anchorDate, b.autopay, b.isActive]));
  await audit(userId, "data.exported", { type: "export" }, { kind: "full" });
  return createZip([
    { name: "transactions.csv", content: transactions },
    { name: "accounts.csv", content: accounts },
    { name: "goals.csv", content: goals.goalsCsvText },
    { name: "goal-contributions.csv", content: goals.contributionsCsv },
    { name: `budget-${monthKey(today)}.csv`, content: budget },
    { name: "subscriptions.csv", content: subsCsv },
    { name: "bills.csv", content: billsCsv },
    { name: "summary.csv", content: summary },
  ]);
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string | Uint8Array<ArrayBuffer>;
}

/** Builds one download for the signed-in user and records it in the audit log. */
export async function exportFile(userId: string, type: ExportType, q: z.infer<typeof exportQuerySchema>): Promise<ExportFile> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const today = todayIn(user.timeZone);
  const filename = exportFileName(type, today, { month: q.month, from: q.from, to: q.to });
  const csv = "text/csv; charset=utf-8";
  if (type === "all") {
    // fullExportZip records its own audit entry.
    return { filename, contentType: "application/zip", body: await fullExportZip(userId) };
  }
  let body: string;
  switch (type) {
    case "transactions":
      body = await transactionsCsv(userId, q);
      break;
    case "budget":
      body = await budgetCsv(userId, q.month ?? monthKey(today));
      break;
    case "goals":
      body = (await goalsCsv(userId, user.timeZone)).goalsCsvText;
      break;
    case "contributions":
      body = (await goalsCsv(userId, user.timeZone)).contributionsCsv;
      break;
    case "summary":
      body = await summaryCsv(userId);
      break;
    case "accounts":
      body = await accountsCsv(userId);
      break;
  }
  await audit(userId, "data.exported", { type: "export" }, { kind: type, ...(q.month ? { month: q.month } : {}), ...(q.from || q.to ? { from: q.from ?? null, to: q.to ?? null } : {}) });
  return { filename, contentType: csv, body };
}
