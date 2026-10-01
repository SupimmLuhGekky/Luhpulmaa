import { z } from "zod";
import type { Budget } from "@prisma/client";
import { apiRoute, json } from "@/lib/api/route";
import { notFound } from "@/lib/api/errors";
import { budgetView, createBudgetSchema, findBudget, listBudgets, openOrCreateBudget } from "@/lib/budget/service";
import { fromDbDate, monthKey, todayIn } from "@/lib/dates";
import { toCentsOrNull } from "@/lib/finance/money";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  /** A budget id → that budget's full view. */
  id: z.string().uuid().optional(),
  /** "2026-09" → the monthly budget for that month. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM").optional(),
});

function budgetDTO(b: Budget) {
  return { id: b.id, name: b.name, period: b.period, mode: b.mode, startDate: fromDbDate(b.startDate), endDate: fromDbDate(b.endDate), plannedIncomeCents: toCentsOrNull(b.plannedIncomeCents), notes: b.notes };
}

/**
 * GET /api/budgets            → { budgets, current } (current = this month's view, or null)
 * GET /api/budgets?id=…       → one budget's view (lines, unbudgeted spending, totals, zero-based summary)
 * GET /api/budgets?month=…    → the monthly budget's view for that month
 */
export const GET = apiRoute({ query: querySchema }, async ({ user, query }) => {
  if (query.id) return budgetView(user.id, query.id);
  if (query.month) {
    const budget = await findBudget(user.id, "MONTHLY", `${query.month}-01`);
    if (!budget) throw notFound("Budget");
    return budgetView(user.id, budget.id);
  }
  const month = monthKey(todayIn(user.timeZone));
  const [budgets, current] = await Promise.all([listBudgets(user.id), findBudget(user.id, "MONTHLY", `${month}-01`)]);
  return { budgets, current: current ? await budgetView(user.id, current.id) : null };
});

/** POST /api/budgets → creates a budget (copying the previous one's lines by default). 200 when that period already had one. */
export const POST = apiRoute({ body: createBudgetSchema }, async ({ user, body }) => {
  const { budget, created } = await openOrCreateBudget(user.id, body);
  return json({ budget: budgetDTO(budget), created }, { status: created ? 201 : 200 });
});
