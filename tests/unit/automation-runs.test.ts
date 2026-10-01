import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Run idempotency: one AutomationRun per (automation, idempotency key), recorded with
 * INSERT … ON CONFLICT DO NOTHING so repeated jobs never raise a unique-constraint error.
 * Prisma is replaced by an in-memory fake that enforces the same unique key.
 */
const db = vi.hoisted(() => {
  interface Run {
    id: string;
    automationId: string;
    idempotencyKey: string;
    status: string;
    summary?: string;
  }
  const uniqueError = () => Object.assign(new Error("Unique constraint failed on the fields: (`automationId`,`idempotencyKey`)"), { code: "P2002" });
  const state = { runs: [] as Run[], automations: [] as unknown[], txns: [] as unknown[], seq: 0 };
  const prisma = {
    automation: {
      findMany: vi.fn(async () => state.automations),
      update: vi.fn(async () => ({})),
    },
    automationRun: {
      // The engine must not insert-then-catch any more.
      create: vi.fn(async () => {
        throw uniqueError();
      }),
      createManyAndReturn: vi.fn(async ({ data, skipDuplicates }: { data: Omit<Run, "id">[]; skipDuplicates?: boolean }) => {
        const created: { id: string }[] = [];
        for (const row of data) {
          if (state.runs.some((r) => r.automationId === row.automationId && r.idempotencyKey === row.idempotencyKey)) {
            if (!skipDuplicates) throw uniqueError();
            continue;
          }
          const run = { ...row, id: `run-${++state.seq}` };
          state.runs.push(run);
          created.push({ id: run.id });
        }
        return created;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Run> }) => {
        Object.assign(state.runs.find((r) => r.id === where.id) ?? {}, data);
        return {};
      }),
    },
    goal: { findFirst: vi.fn(async () => ({ name: "Emergency fund" })) },
    transaction: {
      findMany: vi.fn(async () => state.txns),
      update: vi.fn(async () => ({})),
    },
  };
  return { state, prisma };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: db.prisma }));
vi.mock("@/lib/flags", () => ({ isEnabled: () => true }));
vi.mock("@/lib/goals/service", () => ({ addContribution: vi.fn(async () => ({ id: "contribution" })) }));
vi.mock("@/lib/notifications/service", () => ({ notify: vi.fn(async () => null) }));

const { runScheduledAutomations, runTransactionAutomations } = await import("@/lib/automation/engine");
const { addContribution } = await import("@/lib/goals/service");

const USER = "00000000-0000-4000-8000-000000000001";
const GOAL = "11111111-1111-4111-8111-111111111111";

const monthly = {
  id: "a-monthly",
  userId: USER,
  name: "Monthly savings plan",
  trigger: "SCHEDULE_MONTHLY",
  triggerConfig: { dayOfMonth: 1 },
  conditionLogic: "ALL",
  isActive: true,
  conditions: [],
  actions: [{ id: "act-1", type: "ALLOCATE_TO_GOAL", config: { goalId: GOAL, amountCents: 5000 }, sortOrder: 0 }],
};

const metroNote = {
  id: "a-metro",
  userId: USER,
  name: "Metro note",
  trigger: "TRANSACTION_CREATED",
  triggerConfig: {},
  conditionLogic: "ALL",
  isActive: true,
  conditions: [{ field: "MERCHANT", operator: "CONTAINS", value: "Metro", sortOrder: 0 }],
  actions: [{ id: "act-2", type: "SET_NOTE", config: { note: "Groceries" }, sortOrder: 0 }],
};

const txn = (id: string, merchantName: string) => ({
  id,
  userId: USER,
  accountId: "acc",
  merchantName,
  description: merchantName.toUpperCase(),
  amountCents: -4599n,
  categoryId: null,
  type: "EXPENSE",
  date: new Date("2026-09-28T00:00:00Z"),
  isTransfer: false,
});

beforeEach(() => {
  db.state.runs = [];
  db.state.seq = 0;
  vi.clearAllMocks();
});

describe("automation run idempotency", () => {
  it("runs a scheduled automation once per period, however often the job runs", async () => {
    db.state.automations = [monthly];
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await runScheduledAutomations(USER, "2026-10-01"));
    // Later in the month the key is still "month:2026-10".
    results.push(await runScheduledAutomations(USER, "2026-10-15"));

    expect(results.map((r) => r.executed)).toEqual([1, 0, 0, 0, 0]);
    expect(db.state.runs).toHaveLength(1);
    expect(db.state.runs[0]).toMatchObject({ idempotencyKey: "month:2026-10", status: "SUCCESS" });
    expect(addContribution).toHaveBeenCalledTimes(1);
    expect(db.prisma.automation.update).toHaveBeenCalledTimes(1); // executionCount +1 once
    // Recorded without raising: never insert-then-catch.
    expect(db.prisma.automationRun.create).not.toHaveBeenCalled();
    for (const [args] of db.prisma.automationRun.createManyAndReturn.mock.calls) expect(args.skipDuplicates).toBe(true);
  });

  it("runs again for the next period", async () => {
    db.state.automations = [monthly];
    await runScheduledAutomations(USER, "2026-10-01");
    const next = await runScheduledAutomations(USER, "2026-11-01");
    expect(next.executed).toBe(1);
    expect(db.state.runs.map((r) => r.idempotencyKey)).toEqual(["month:2026-10", "month:2026-11"]);
  });

  it("applies a transaction automation once per transaction across repeated syncs", async () => {
    db.state.automations = [metroNote];
    db.state.txns = [txn("t-1", "Metro"), txn("t-2", "Uber")];
    const first = await runTransactionAutomations(USER, ["t-1", "t-2"]);
    const second = await runTransactionAutomations(USER, ["t-1", "t-2"]);

    expect(first.executed).toBe(1);
    expect(second.executed).toBe(0);
    expect(db.state.runs.map((r) => r.idempotencyKey)).toEqual(["txn:t-1"]); // Uber didn't match: no run recorded
    expect(db.prisma.transaction.update).toHaveBeenCalledTimes(1);
    expect(db.prisma.automationRun.create).not.toHaveBeenCalled();
  });
});
