import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { addContribution, createGoal, deleteContribution, goalDetail, listGoalItems } from "@/lib/goals/service";
import { goalsCsv } from "@/lib/export/service";
import { balanceOf, createUser, freezeTime, manualAccount } from "./helpers/factory";

/**
 * Goals track two kinds of money separately: planned allocations (earmarks, nothing
 * moved) and transfers the user reports having made. The app never moves money.
 */
let userId: string;
let savingsId: string;

beforeAll(async () => {
  freezeTime();
  userId = (await createUser({ firstName: "Jade" })).id;
  savingsId = (await manualAccount(userId, { name: "Fictional Savings", type: "SAVINGS", balanceCents: 250_000 })).id;
});

describe("goal contributions", () => {
  let goalId: string;

  it("keeps planned allocations and reported transfers apart, and their sum is the goal's amount", async () => {
    const goal = await createGoal(userId, { name: "Fictional trip to Gaspésie", targetCents: 200_000, startingCents: 20_000, priority: "HIGH", icon: "plane", color: "#f59e0b", linkedAccountId: savingsId });
    goalId = goal.id;
    await addContribution(userId, goalId, { amountCents: 30_000, date: "2026-09-15", kind: "PLANNED_ALLOCATION", source: "MANUAL", note: "From September's plan" });
    await addContribution(userId, goalId, { amountCents: 50_000, date: "2026-09-30", kind: "USER_REPORTED_TRANSFER", source: "MANUAL", note: "Moved to savings" });

    const detail = await goalDetail(userId, goalId, "America/Toronto");
    // The starting balance counts as money the user already set aside.
    expect(detail.totals).toEqual({ planned: 30_000, actual: 70_000, total: 100_000 });
    expect(detail.progress).toMatchObject({ target: 200_000, current: 100_000, remaining: 100_000, progressBps: 5000, isComplete: false });
    expect(detail.contributions.map((c) => [c.kind, c.amount])).toEqual([
      ["PLANNED_ALLOCATION", 30_000],
      ["USER_REPORTED_TRANSFER", 50_000],
      ["USER_REPORTED_TRANSFER", 20_000],
    ]);
    expect(detail.growth.at(-1)).toMatchObject({ date: "2026-10-01", planned: 30_000, actual: 70_000, total: 100_000 });
    expect((await listGoalItems(userId, "America/Toronto")).find((g) => g.id === goalId)?.totals).toEqual(detail.totals);
  });

  it("never moves money", async () => {
    expect(await balanceOf(savingsId)).toBe(250_000);
    expect(await prisma.transaction.count({ where: { userId } })).toBe(0);
  });

  it("refuses verified transfers, which need a regulated partner", async () => {
    await expect(addContribution(userId, goalId, { amountCents: 1_000, date: "2026-10-01", kind: "PROVIDER_TRANSFER", source: "MANUAL" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.goalContribution.count({ where: { goalId } })).toBe(3);
  });

  it("records an automated allocation only once per idempotency key", async () => {
    const input = { amountCents: 2_500, date: "2026-10-01", kind: "PLANNED_ALLOCATION" as const, source: "AUTOMATION" as const, idempotencyKey: "fictional-run-1" };
    expect(await addContribution(userId, goalId, input)).not.toBeNull();
    expect(await addContribution(userId, goalId, input)).toBeNull();
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: goalId } })).toMatchObject({ currentCents: 102_500n });
  });

  it("can't withdraw more than was planned or moved", async () => {
    await expect(addContribution(userId, goalId, { amountCents: -40_000, date: "2026-10-01", kind: "PLANNED_ALLOCATION", source: "MANUAL" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(addContribution(userId, goalId, { amountCents: -200_000, date: "2026-10-01", kind: "USER_REPORTED_TRANSFER", source: "MANUAL" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await addContribution(userId, goalId, { amountCents: -10_000, date: "2026-10-01", kind: "USER_REPORTED_TRANSFER", source: "MANUAL", note: "Took some back" });
    expect((await goalDetail(userId, goalId, "America/Toronto")).totals).toEqual({ planned: 32_500, actual: 60_000, total: 92_500 });
  });

  it("completes at the target, notifies each milestone once and reopens when a contribution is removed", async () => {
    const last = await addContribution(userId, goalId, { amountCents: 107_500, date: "2026-10-01", kind: "USER_REPORTED_TRANSFER", source: "MANUAL" });
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: goalId } })).toMatchObject({ status: "COMPLETED", currentCents: 200_000n });
    const titles = (await prisma.notification.findMany({ where: { userId, type: "GOAL_PROGRESS" }, orderBy: { createdAt: "asc" } })).map((n) => n.title);
    expect(titles).toEqual(["Fictional trip to Gaspésie is 25% funded", "Fictional trip to Gaspésie is 50% funded", "Fictional trip to Gaspésie is 75% funded", "Fictional trip to Gaspésie reached!"]);

    await deleteContribution(userId, last!.id);
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: goalId } })).toMatchObject({ status: "ACTIVE", completedAt: null, currentCents: 92_500n });
  });

  it("exports contributions with their kind spelled out", async () => {
    const { contributionsCsv } = await goalsCsv(userId, "America/Toronto");
    const lines = contributionsCsv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Date,Goal,Amount,Kind,Source,Note");
    expect(lines).toContain("2026-09-15,Fictional trip to Gaspésie,300.00,planned allocation,manual,From September's plan");
    expect(lines).toContain("2026-09-30,Fictional trip to Gaspésie,500.00,transfer reported by you,manual,Moved to savings");
    expect(lines).toContain("2026-10-01,Fictional trip to Gaspésie,-100.00,transfer reported by you,manual,Took some back");
  });
});
