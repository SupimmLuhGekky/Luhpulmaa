import "server-only";
import type { Frequency } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { fromDbDate, todayIn, toDbDate, type LocalDate } from "@/lib/dates";
import { monthlyEquivalent, yearlyEquivalent } from "@/lib/finance/frequency";
import { toCents, type Cents } from "@/lib/finance/money";
import { addContribution } from "@/lib/goals/service";
import { previewAllocation } from "./allocation";
import { nextPayday, paydaysBetween, type ExpectedPayday } from "./schedule";

export { previewAllocation, type AllocationLine, type AllocationPreview } from "./allocation";

export const PAY_FREQUENCIES = ["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY"] as const;

export const incomeSourceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  frequency: z.enum(PAY_FREQUENCIES),
  averageAmountCents: z.number().int().positive().max(100_000_000),
  nextExpectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  semiMonthlyDays: z.array(z.number().int().min(1).max(31)).length(2).optional(),
  accountId: z.string().uuid().nullable().optional(),
  matchPattern: z.string().trim().max(80).nullable().optional(),
  isPrimary: z.boolean().optional(),
});

export interface IncomeEstimate {
  perPaycheck: Cents;
  monthly: Cents;
  yearly: Cents;
  nextPayday: LocalDate | null;
}

/** Estimated income for one source (all values are estimates and labelled as such in the UI). */
export function estimateIncome(source: { averageAmountCents: Cents; frequency: Frequency; nextExpectedDate: LocalDate | null; lastPaidDate: LocalDate | null; semiMonthlyDays: number[] }, today: LocalDate): IncomeEstimate {
  return {
    perPaycheck: source.averageAmountCents,
    monthly: monthlyEquivalent(source.averageAmountCents, source.frequency),
    yearly: yearlyEquivalent(source.averageAmountCents, source.frequency),
    nextPayday: nextPayday({ id: "", name: "", ...source }, today),
  };
}

export async function listIncomeSources(userId: string, timeZone: string) {
  const today = todayIn(timeZone);
  const rows = await prisma.incomeSource.findMany({ where: { userId, isActive: true }, include: { account: { select: { id: true, name: true } } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
  const sources = rows.map((r) => {
    const base = {
      averageAmountCents: toCents(r.averageAmountCents),
      frequency: r.frequency,
      nextExpectedDate: fromDbDate(r.nextExpectedDate),
      lastPaidDate: fromDbDate(r.lastPaidDate),
      semiMonthlyDays: r.semiMonthlyDays,
    };
    return { id: r.id, name: r.name, isPrimary: r.isPrimary, isDetected: r.isDetected, matchPattern: r.matchPattern, account: r.account, ...base, estimate: estimateIncome(base, today) };
  });
  const totals = {
    monthly: sources.reduce((a, s) => a + s.estimate.monthly, 0),
    yearly: sources.reduce((a, s) => a + s.estimate.yearly, 0),
    nextPayday: sources.map((s) => s.estimate.nextPayday).filter((d): d is string => Boolean(d)).sort()[0] ?? null,
  };
  return { sources, totals, today };
}

/** All expected paydays in a window, across active sources (used by forecast and safe-to-spend). */
export async function expectedPaydays(userId: string, from: LocalDate, to: LocalDate): Promise<ExpectedPayday[]> {
  const rows = await prisma.incomeSource.findMany({ where: { userId, isActive: true } });
  const out = rows.flatMap((r) =>
    paydaysBetween(
      {
        id: r.id,
        name: r.name,
        frequency: r.frequency,
        averageAmountCents: toCents(r.averageAmountCents),
        lastPaidDate: fromDbDate(r.lastPaidDate),
        nextExpectedDate: fromDbDate(r.nextExpectedDate),
        semiMonthlyDays: r.semiMonthlyDays,
      },
      from,
      to,
    ),
  );
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function upsertIncomeSource(userId: string, id: string | null, input: z.infer<typeof incomeSourceSchema>) {
  if (input.accountId) {
    const owned = await prisma.account.count({ where: { id: input.accountId, userId } });
    if (!owned) throw notFound("Account");
  }
  // On edit, fields the caller leaves out are kept: dropping the match pattern would
  // unlink a detected source from its paycheques and the next sync would re-create it.
  const keep = (v: unknown) => Boolean(id) && v === undefined;
  const data = {
    name: input.name,
    frequency: input.frequency,
    averageAmountCents: input.averageAmountCents,
    nextExpectedDate: toDbDate(input.nextExpectedDate),
    ...(keep(input.semiMonthlyDays) ? {} : { semiMonthlyDays: input.semiMonthlyDays ?? [15, 31] }),
    ...(keep(input.accountId) ? {} : { accountId: input.accountId ?? null }),
    ...(keep(input.matchPattern) ? {} : { matchPattern: input.matchPattern ?? null }),
    isDetected: false,
  };
  let source;
  if (id) {
    const existing = await prisma.incomeSource.findFirst({ where: { id, userId } });
    if (!existing) throw notFound("Income source");
    source = await prisma.incomeSource.update({ where: { id }, data });
  } else {
    source = await prisma.incomeSource.create({ data: { userId, ...data } });
  }
  // The first source becomes the primary one.
  const makePrimary = input.isPrimary || (!id && (await prisma.incomeSource.count({ where: { userId, isActive: true, isPrimary: true } })) === 0);
  if (makePrimary) {
    await prisma.$transaction([
      prisma.incomeSource.updateMany({ where: { userId, id: { not: source.id } }, data: { isPrimary: false } }),
      prisma.incomeSource.update({ where: { id: source.id }, data: { isPrimary: true } }),
    ]);
  }
  await audit(userId, "income.changed", { type: "income_source", id: source.id });
  return source;
}

export async function deleteIncomeSource(userId: string, id: string) {
  const existing = await prisma.incomeSource.findFirst({ where: { id, userId }, select: { isPrimary: true } });
  if (!existing) throw notFound("Income source");
  await prisma.incomeSource.delete({ where: { id } });
  if (existing.isPrimary) {
    // Keep one primary source: promote the oldest remaining one.
    const next = await prisma.incomeSource.findFirst({ where: { userId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (next) await prisma.incomeSource.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
  await audit(userId, "income.changed", { type: "income_source", id }, { deleted: true });
}

/** Marks one source as the primary paycheque (used for defaults such as plan previews). */
export async function setPrimaryIncomeSource(userId: string, id: string) {
  const existing = await prisma.incomeSource.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) throw notFound("Income source");
  await prisma.$transaction([
    prisma.incomeSource.updateMany({ where: { userId, id: { not: id } }, data: { isPrimary: false } }),
    prisma.incomeSource.update({ where: { id }, data: { isPrimary: true } }),
  ]);
  await audit(userId, "income.changed", { type: "income_source", id }, { primary: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Smart allocation plans ("every paycheque: 50/20/20/10")
// ─────────────────────────────────────────────────────────────────────────────

export const allocationPlanSchema = z.object({
  name: z.string().trim().min(1).max(60),
  incomeSourceId: z.string().uuid().nullable().optional(),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        method: z.enum(["PERCENT", "FIXED"]),
        percentBps: z.number().int().min(0).max(10000).nullable().optional(),
        amountCents: z.number().int().min(0).nullable().optional(),
        categoryId: z.string().uuid().nullable().optional(),
        goalId: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
});

export async function listAllocationPlans(userId: string) {
  const plans = await prisma.allocationPlan.findMany({
    where: { userId },
    include: { items: { orderBy: { sortOrder: "asc" }, include: { goal: { select: { id: true, name: true } }, category: { select: { id: true, name: true } } } }, incomeSource: { select: { id: true, name: true, averageAmountCents: true } } },
    orderBy: { createdAt: "asc" },
  });
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    isActive: p.isActive,
    incomeSource: p.incomeSource ? { id: p.incomeSource.id, name: p.incomeSource.name, averageAmountCents: toCents(p.incomeSource.averageAmountCents) } : null,
    items: p.items.map((i) => ({ id: i.id, label: i.label, method: i.method, percentBps: i.percentBps, amountCents: i.amountCents === null ? null : toCents(i.amountCents), goal: i.goal, category: i.category })),
  }));
}

export async function saveAllocationPlan(userId: string, id: string | null, input: z.infer<typeof allocationPlanSchema>) {
  const goalIds = input.items.map((i) => i.goalId).filter((x): x is string => Boolean(x));
  const catIds = input.items.map((i) => i.categoryId).filter((x): x is string => Boolean(x));
  const [goals, cats] = await Promise.all([
    prisma.goal.count({ where: { userId, id: { in: goalIds } } }),
    prisma.category.count({ where: { userId, id: { in: catIds } } }),
  ]);
  if (goals !== new Set(goalIds).size || cats !== new Set(catIds).size) throw notFound("Goal or category");
  if (input.incomeSourceId && !(await prisma.incomeSource.count({ where: { id: input.incomeSourceId, userId } }))) throw notFound("Income source");
  const items = input.items.map((i, idx) => ({ label: i.label, method: i.method, percentBps: i.method === "PERCENT" ? (i.percentBps ?? 0) : null, amountCents: i.method === "FIXED" ? (i.amountCents ?? 0) : null, goalId: i.goalId ?? null, categoryId: i.categoryId ?? null, sortOrder: idx }));
  return prisma.$transaction(async (tx) => {
    if (id) {
      const existing = await tx.allocationPlan.findFirst({ where: { id, userId } });
      if (!existing) throw notFound("Plan");
      await tx.allocationItem.deleteMany({ where: { planId: id } });
      return tx.allocationPlan.update({ where: { id }, data: { name: input.name, incomeSourceId: input.incomeSourceId ?? null, items: { create: items } } });
    }
    return tx.allocationPlan.create({ data: { userId, name: input.name, incomeSourceId: input.incomeSourceId ?? null, items: { create: items } } });
  });
}

export async function deleteAllocationPlan(userId: string, id: string) {
  const { count } = await prisma.allocationPlan.deleteMany({ where: { id, userId } });
  if (!count) throw notFound("Plan");
}

/**
 * Records the goal lines of a plan as PLANNED allocations for one paycheque. No money
 * moves: these are earmarks the user can later match with real transfers.
 * Idempotent per (plan, paycheque date, goal): applying the same plan to the same
 * paycheque again — even after editing the plan — never earmarks a goal twice.
 * Lines pointing at the same goal are combined; archived goals are skipped.
 */
export async function applyAllocationPlan(userId: string, planId: string, incomeCents: Cents, date: LocalDate) {
  const plan = await prisma.allocationPlan.findFirst({ where: { id: planId, userId }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!plan) throw notFound("Plan");
  const preview = previewAllocation(
    incomeCents,
    plan.items.map((i) => ({ label: i.label, method: i.method, percentBps: i.percentBps, amountCents: i.amountCents === null ? null : toCents(i.amountCents), goalId: i.goalId, categoryId: i.categoryId })),
  );
  const perGoal = new Map<string, { amount: Cents; labels: string[] }>();
  for (const line of preview.lines) {
    if (!line.goalId || line.amount <= 0) continue;
    const entry = perGoal.get(line.goalId) ?? { amount: 0, labels: [] };
    entry.amount += line.amount;
    entry.labels.push(line.label);
    perGoal.set(line.goalId, entry);
  }
  const archived = new Set(
    (await prisma.goal.findMany({ where: { userId, id: { in: [...perGoal.keys()] }, status: "ARCHIVED" }, select: { id: true } })).map((g) => g.id),
  );
  let recorded = 0;
  let recordedCents = 0;
  let alreadyApplied = 0;
  for (const [goalId, entry] of perGoal) {
    if (archived.has(goalId)) continue;
    const c = await addContribution(userId, goalId, {
      amountCents: entry.amount,
      date,
      kind: "PLANNED_ALLOCATION",
      source: "ALLOCATION_PLAN",
      note: `${plan.name}: ${entry.labels.join(", ")}`.slice(0, 200),
      idempotencyKey: `plan:${plan.id}:${date}:goal:${goalId}`,
    });
    if (c) {
      recorded++;
      recordedCents += entry.amount;
    } else alreadyApplied++;
  }
  return { ...preview, recorded, recordedCents, alreadyApplied, skippedArchived: archived.size };
}
