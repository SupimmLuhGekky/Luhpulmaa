import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Set the category" from an automation: the category decides the transaction's type and
 * transfer flag, exactly as when the person changes the category by hand. Prisma is an
 * in-memory fake.
 */
const db = vi.hoisted(() => {
  const ids = { housing: "22222222-2222-4222-8222-222222222201", salary: "22222222-2222-4222-8222-222222222202", transfers: "22222222-2222-4222-8222-222222222203" };
  const categories: Record<string, { id: string; name: string; kind: "EXPENSE" | "INCOME" | "TRANSFER"; subcategories: { id: string }[] }> = {
    [ids.housing]: { id: ids.housing, name: "Housing", kind: "EXPENSE", subcategories: [] },
    [ids.salary]: { id: ids.salary, name: "Salary", kind: "INCOME", subcategories: [] },
    [ids.transfers]: { id: ids.transfers, name: "Transfers", kind: "TRANSFER", subcategories: [] },
  };
  const state = { automations: [] as unknown[], txns: [] as unknown[], seq: 0 };
  const prisma = {
    automation: { findMany: vi.fn(async () => state.automations), update: vi.fn(async () => ({})) },
    automationRun: {
      createManyAndReturn: vi.fn(async () => [{ id: `run-${++state.seq}` }]),
      update: vi.fn(async () => ({})),
    },
    category: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => categories[where.id] ?? null) },
    goal: { findFirst: vi.fn(async () => null) },
    transaction: { findMany: vi.fn(async () => state.txns), update: vi.fn(async () => ({})) },
  };
  return { state, prisma, ids };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: db.prisma }));
vi.mock("@/lib/flags", () => ({ isEnabled: () => true }));
vi.mock("@/lib/goals/service", () => ({ addContribution: vi.fn(async () => ({ id: "contribution" })) }));
vi.mock("@/lib/notifications/service", () => ({ notify: vi.fn(async () => null) }));

const { runTransactionAutomations } = await import("@/lib/automation/engine");

const USER = "00000000-0000-4000-8000-000000000001";
const NOT_THEIRS = "22222222-2222-4222-8222-222222222299";

const fileUnder = (categoryId: string) => ({
  id: `a-${categoryId.slice(-2)}`,
  userId: USER,
  name: "File it",
  trigger: "TRANSACTION_CREATED",
  triggerConfig: {},
  conditionLogic: "ALL",
  isActive: true,
  conditions: [],
  actions: [{ id: "act", type: "SET_CATEGORY", config: { categoryId }, sortOrder: 0 }],
});

const txn = (amountCents: bigint, type: string, isTransfer: boolean) => ({
  id: "t-1",
  userId: USER,
  accountId: "acc",
  merchantName: null,
  description: "VIREMENT INTERAC LANDLORD",
  amountCents,
  categoryId: null,
  type,
  date: new Date("2026-10-01T00:00:00Z"),
  isTransfer,
});

const updatedWith = () => (db.prisma.transaction.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;

beforeEach(() => {
  db.state.seq = 0;
  vi.clearAllMocks();
});

describe("SET_CATEGORY", () => {
  it("makes a transfer-looking payment spending when filed under an expense category", async () => {
    db.state.automations = [fileUnder(db.ids.housing)];
    db.state.txns = [txn(-95_000n, "TRANSFER", true)];
    expect((await runTransactionAutomations(USER, ["t-1"])).executed).toBe(1);
    expect(updatedWith()).toMatchObject({ categoryId: db.ids.housing, categorizedBy: "AUTOMATION", type: "EXPENSE", isTransfer: false });
  });

  it("treats money coming back under an expense category as a refund", async () => {
    db.state.automations = [fileUnder(db.ids.housing)];
    db.state.txns = [txn(12_000n, "INCOME", false)];
    await runTransactionAutomations(USER, ["t-1"]);
    expect(updatedWith()).toMatchObject({ type: "REFUND", isTransfer: false });
  });

  it("makes a deposit income under an income category", async () => {
    db.state.automations = [fileUnder(db.ids.salary)];
    db.state.txns = [txn(250_000n, "TRANSFER", true)];
    await runTransactionAutomations(USER, ["t-1"]);
    expect(updatedWith()).toMatchObject({ categoryId: db.ids.salary, type: "INCOME", isTransfer: false });
  });

  it("marks it as a transfer under a transfer category", async () => {
    db.state.automations = [fileUnder(db.ids.transfers)];
    db.state.txns = [txn(-50_000n, "EXPENSE", false)];
    await runTransactionAutomations(USER, ["t-1"]);
    expect(updatedWith()).toMatchObject({ categoryId: db.ids.transfers, type: "TRANSFER", isTransfer: true });
  });

  it("leaves the transaction alone when the category isn't the user's", async () => {
    db.state.automations = [fileUnder(NOT_THEIRS)];
    db.state.txns = [txn(-95_000n, "TRANSFER", true)];
    await runTransactionAutomations(USER, ["t-1"]);
    expect(db.prisma.transaction.update).not.toHaveBeenCalled();
  });
});
