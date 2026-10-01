import "server-only";
import type { ContributionKind, ContributionSource, Priority, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AppError, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { addDays, dateInZone, fromDbDate, todayIn, toDbDate, type LocalDate } from "@/lib/dates";
import { calculateGoalPace, calculateGoalProgress, type GoalPace, type GoalProgress } from "@/lib/finance/calculations";
import { formatCurrency, toCents, type Cents } from "@/lib/finance/money";
import { notify } from "@/lib/notifications/service";
import { growthSeries, totalsByKind, type GrowthPoint, type KindTotals } from "./contributions";

export const goalInputSchema = z.object({
  name: z.string().trim().min(1, "Required").max(60),
  description: z.string().trim().max(300).nullable().optional(),
  targetCents: z.number().int().positive("Target must be more than $0").max(100_000_000_00),
  startingCents: z.number().int().min(0).max(100_000_000_00).optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  icon: z.string().max(40).default("target"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0ea5e9"),
  linkedAccountId: z.string().uuid().nullable().optional(),
});

export const goalUpdateSchema = goalInputSchema.omit({ startingCents: true }).partial().extend({ status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).optional() });

export const contributionInputSchema = z.object({
  amountCents: z.number().int().refine((v) => v !== 0, "Amount can't be zero").refine((v) => Math.abs(v) <= 100_000_000_00),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(["PLANNED_ALLOCATION", "USER_REPORTED_TRANSFER"]).default("PLANNED_ALLOCATION"),
  note: z.string().trim().max(200).nullable().optional(),
});

async function assertAccountOwned(userId: string, accountId: string | null | undefined) {
  if (!accountId) return;
  const owned = await prisma.account.count({ where: { id: accountId, userId } });
  if (!owned) throw notFound("Account");
}

export async function listGoals(userId: string, opts: { includeArchived?: boolean } = {}) {
  return prisma.goal.findMany({
    where: { userId, ...(opts.includeArchived ? {} : { status: { not: "ARCHIVED" } }) },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: { linkedAccount: { select: { id: true, name: true } } },
  });
}

export async function getGoal(userId: string, goalId: string) {
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, userId },
    include: {
      linkedAccount: { select: { id: true, name: true } },
      contributions: { orderBy: [{ date: "asc" }, { createdAt: "asc" }], include: { automation: { select: { id: true, name: true } } } },
    },
  });
  if (!goal) throw notFound("Goal");
  return goal;
}

export async function createGoal(userId: string, input: z.infer<typeof goalInputSchema>, source: ContributionSource = "MANUAL") {
  await assertAccountOwned(userId, input.linkedAccountId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const today = todayIn(user.timeZone);
  const goal = await prisma.$transaction(async (tx) => {
    const created = await tx.goal.create({
      data: {
        userId,
        name: input.name,
        description: input.description ?? null,
        targetCents: input.targetCents,
        deadline: input.deadline ? toDbDate(input.deadline) : null,
        priority: input.priority as Priority,
        icon: input.icon,
        color: input.color,
        linkedAccountId: input.linkedAccountId ?? null,
      },
    });
    if (input.startingCents && input.startingCents > 0) {
      await tx.goalContribution.create({
        data: { userId, goalId: created.id, amountCents: input.startingCents, date: toDbDate(today), kind: "USER_REPORTED_TRANSFER", source, note: "Starting balance" },
      });
      await tx.goal.update({ where: { id: created.id }, data: { currentCents: input.startingCents } });
    }
    return created;
  });
  await audit(userId, "goal.created", { type: "goal", id: goal.id }, { name: goal.name, targetCents: input.targetCents });
  return goal;
}

export async function updateGoal(userId: string, goalId: string, input: z.infer<typeof goalUpdateSchema>) {
  const existing = await prisma.goal.findFirst({ where: { id: goalId, userId } });
  if (!existing) throw notFound("Goal");
  await assertAccountOwned(userId, input.linkedAccountId);
  const data: Prisma.GoalUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.targetCents !== undefined) data.targetCents = input.targetCents;
  if (input.deadline !== undefined) data.deadline = input.deadline ? toDbDate(input.deadline) : null;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.color !== undefined) data.color = input.color;
  if (input.linkedAccountId !== undefined) data.linkedAccount = input.linkedAccountId ? { connect: { id: input.linkedAccountId } } : { disconnect: true };
  if (input.status !== undefined) {
    data.status = input.status;
    data.completedAt = input.status === "COMPLETED" ? new Date() : null;
  } else if (input.targetCents !== undefined) {
    // A new target can complete an active goal or reopen a completed one.
    const reached = existing.currentCents >= BigInt(input.targetCents);
    if (existing.status === "ACTIVE" && reached) {
      data.status = "COMPLETED";
      data.completedAt = new Date();
    } else if (existing.status === "COMPLETED" && !reached) {
      data.status = "ACTIVE";
      data.completedAt = null;
    }
  }
  const goal = await prisma.goal.update({ where: { id: goalId }, data });
  await audit(userId, "goal.updated", { type: "goal", id: goalId }, { fields: Object.keys(input) });
  return goal;
}

export async function deleteGoal(userId: string, goalId: string) {
  const { count } = await prisma.goal.deleteMany({ where: { id: goalId, userId } });
  if (!count) throw notFound("Goal");
  await audit(userId, "goal.deleted", { type: "goal", id: goalId });
}

const MILESTONES = [2500, 5000, 7500, 10000];

/**
 * Records a contribution and keeps Goal.currentCents in sync atomically.
 * With an idempotency key the same automated allocation can never be recorded twice.
 * Returns null when the idempotency key was already used.
 */
export async function addContribution(
  userId: string,
  goalId: string,
  input: { amountCents: Cents; date: LocalDate; kind: ContributionKind; source: ContributionSource; note?: string | null; automationId?: string | null; transactionId?: string | null; idempotencyKey?: string | null },
) {
  if (input.kind === "PROVIDER_TRANSFER") {
    // Reserved for verified money movement through a regulated partner (not available in v1).
    throw new AppError("FORBIDDEN", "Verified transfers are not available.");
  }
  const result = await prisma.$transaction(async (tx) => {
    const goal = await tx.goal.findFirst({ where: { id: goalId, userId } });
    if (!goal) throw notFound("Goal");
    if (input.idempotencyKey) {
      const dup = await tx.goalContribution.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }, select: { id: true } });
      if (dup) return null;
    }
    const before = toCents(goal.currentCents);
    if (input.amountCents < 0 && before + input.amountCents < 0) {
      throw new AppError("VALIDATION_FAILED", `You can't take out more than the ${formatCurrency(before)} set aside for this goal.`);
    }
    const contribution = await tx.goalContribution.create({
      data: {
        userId,
        goalId,
        amountCents: input.amountCents,
        date: toDbDate(input.date),
        kind: input.kind,
        source: input.source,
        note: input.note ?? null,
        automationId: input.automationId ?? null,
        transactionId: input.transactionId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    const updated = await tx.goal.update({ where: { id: goalId }, data: { currentCents: { increment: input.amountCents } } });
    const after = toCents(updated.currentCents);
    const target = toCents(goal.targetCents);
    if (after >= target && goal.status === "ACTIVE") {
      await tx.goal.update({ where: { id: goalId }, data: { status: "COMPLETED", completedAt: new Date() } });
    } else if (after < target && goal.status === "COMPLETED") {
      await tx.goal.update({ where: { id: goalId }, data: { status: "ACTIVE", completedAt: null } });
    }
    return { contribution, goal, before, after, target };
  });
  if (!result) return null;
  const { goal, before, after, target } = result;
  for (const m of MILESTONES) {
    const threshold = Math.ceil((target * m) / 10000);
    if (before < threshold && after >= threshold) {
      await notify(userId, {
        type: "GOAL_PROGRESS",
        severity: m === 10000 ? "SUCCESS" : "INFO",
        title: m === 10000 ? `${goal.name} reached!` : `${goal.name} is ${m / 100}% funded`,
        body: `${formatCurrency(after)} of ${formatCurrency(target)} set aside.`,
        href: `/goals/${goal.id}`,
        dedupeKey: `goal:${goal.id}:milestone:${m}`,
      });
    }
  }
  if (input.source === "MANUAL") await audit(userId, "goal.contribution", { type: "goal", id: goalId }, { amountCents: input.amountCents, kind: input.kind });
  return result.contribution;
}

export async function deleteContribution(userId: string, contributionId: string) {
  await prisma.$transaction(async (tx) => {
    const c = await tx.goalContribution.findFirst({ where: { id: contributionId, userId } });
    if (!c) throw notFound("Contribution");
    await tx.goalContribution.delete({ where: { id: c.id } });
    const goal = await tx.goal.update({ where: { id: c.goalId }, data: { currentCents: { decrement: c.amountCents } } });
    if (goal.status === "COMPLETED" && goal.currentCents < goal.targetCents) {
      await tx.goal.update({ where: { id: goal.id }, data: { status: "ACTIVE", completedAt: null } });
    }
  });
}

/** Goal with computed progress, pace and growth series — used by pages and the API. */
export async function goalSummary(userId: string, goalId: string, timeZone: string) {
  const goal = await getGoal(userId, goalId);
  const today = todayIn(timeZone);
  const progress = calculateGoalProgress(toCents(goal.targetCents), toCents(goal.currentCents), fromDbDate(goal.deadline), today);
  const contributions = goal.contributions.map((c) => ({
    id: c.id,
    date: fromDbDate(c.date),
    amount: toCents(c.amountCents),
    kind: c.kind,
    source: c.source,
    note: c.note,
    automation: c.automation,
    transactionId: c.transactionId,
  }));
  const pace = calculateGoalPace(progress, contributions, today);
  let running = 0;
  const growth = contributions.map((c) => {
    running += c.amount;
    return { date: c.date, total: running };
  });
  return { goal, progress, pace, contributions, growth, today };
}

export interface GoalListItem {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  priority: Priority;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  deadline: LocalDate | null;
  createdOn: LocalDate;
  completedOn: LocalDate | null;
  linkedAccount: { id: string; name: string } | null;
  /** Planned allocations vs actual transfers (their sum is the goal's current amount). */
  totals: KindTotals;
  progress: GoalProgress;
  pace: GoalPace;
  lastContributionDate: LocalDate | null;
  contributionCount: number;
}

export interface GoalContributionItem {
  id: string;
  date: LocalDate;
  amount: Cents;
  kind: ContributionKind;
  source: ContributionSource;
  note: string | null;
  automation: { id: string; name: string } | null;
  transactionId: string | null;
}

export interface GoalDetail extends GoalListItem {
  contributions: GoalContributionItem[];
  growth: GrowthPoint[];
  today: LocalDate;
}

type GoalRow = Awaited<ReturnType<typeof listGoals>>[number];

function toListItem(g: GoalRow, timeZone: string, today: LocalDate, stats: { totals: KindTotals; recent: { date: LocalDate; amount: Cents }[]; last: LocalDate | null; count: number }): GoalListItem {
  const progress = calculateGoalProgress(toCents(g.targetCents), toCents(g.currentCents), fromDbDate(g.deadline), today);
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    icon: g.icon,
    color: g.color,
    priority: g.priority,
    status: g.status,
    deadline: fromDbDate(g.deadline),
    createdOn: dateInZone(g.createdAt, timeZone),
    completedOn: g.completedAt ? dateInZone(g.completedAt, timeZone) : null,
    linkedAccount: g.linkedAccount,
    totals: stats.totals,
    progress,
    pace: calculateGoalPace(progress, stats.recent, today),
    lastContributionDate: stats.last,
    contributionCount: stats.count,
  };
}

/** Every goal (archived included) with progress, pace and the planned/actual split — plain data for pages and the API. */
export async function listGoalItems(userId: string, timeZone: string): Promise<GoalListItem[]> {
  const today = todayIn(timeZone);
  const [goals, byKind, recent] = await Promise.all([
    listGoals(userId, { includeArchived: true }),
    prisma.goalContribution.groupBy({ by: ["goalId", "kind"], where: { userId }, _sum: { amountCents: true }, _max: { date: true }, _count: { _all: true } }),
    prisma.goalContribution.findMany({ where: { userId, date: { gt: toDbDate(addDays(today, -90)), lte: toDbDate(today) } }, select: { goalId: true, date: true, amountCents: true } }),
  ]);
  return goals.map((g) => {
    const rows = byKind.filter((r) => r.goalId === g.id);
    const totals = totalsByKind(rows.map((r) => ({ kind: r.kind, amount: toCents(r._sum.amountCents) })));
    const last = rows.map((r) => fromDbDate(r._max.date)).filter((d): d is LocalDate => Boolean(d)).sort().at(-1) ?? null;
    const count = rows.reduce((a, r) => a + r._count._all, 0);
    const mine = recent.filter((c) => c.goalId === g.id).map((c) => ({ date: fromDbDate(c.date), amount: toCents(c.amountCents) }));
    return toListItem(g, timeZone, today, { totals, recent: mine, last, count });
  });
}

/** One goal with its contribution history and growth series (planned and actual kept apart). */
export async function goalDetail(userId: string, goalId: string, timeZone: string): Promise<GoalDetail> {
  const { goal, contributions, today } = await goalSummary(userId, goalId, timeZone);
  const createdOn = dateInZone(goal.createdAt, timeZone);
  const item = toListItem(goal, timeZone, today, {
    totals: totalsByKind(contributions),
    recent: contributions,
    last: contributions.at(-1)?.date ?? null,
    count: contributions.length,
  });
  return {
    ...item,
    contributions,
    growth: growthSeries(contributions, { startAt: createdOn, extendTo: today }),
    today,
  };
}

export async function checkGoalDeadlines(userId: string, today: LocalDate) {
  const goals = await prisma.goal.findMany({ where: { userId, status: "ACTIVE", deadline: { not: null, lte: toDbDate(addDays(today, 30)) } } });
  for (const g of goals) {
    const deadline = fromDbDate(g.deadline)!;
    const progress = calculateGoalProgress(toCents(g.targetCents), toCents(g.currentCents), deadline, today);
    if (progress.isComplete) continue;
    const days = progress.daysLeft ?? 0;
    const bucket = days < 0 ? "overdue" : days <= 7 ? "7" : "30";
    await notify(userId, {
      type: "GOAL_DEADLINE",
      severity: days < 0 ? "WARNING" : "INFO",
      title: days < 0 ? `${g.name} deadline has passed` : `${g.name} deadline in ${days} day${days === 1 ? "" : "s"}`,
      body: `${formatCurrency(progress.remaining)} still needed to reach ${formatCurrency(progress.target)}.`,
      href: `/goals/${g.id}`,
      dedupeKey: `goal:${g.id}:deadline:${bucket}`,
    });
  }
}
