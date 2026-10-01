import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { connectLunchFlow, previewLunchFlow } from "@/lib/accounts/lunchflow";
import { disconnectConnection, updateAccount } from "@/lib/accounts/service";
import { syncConnection } from "@/lib/sync/service";
import { decryptSecret } from "@/lib/security/encryption";
import { balanceOf, createUser, freezeTime, manualAccount, seedTransactions } from "./helpers/factory";

/**
 * Lunch Flow against an in-memory stand-in for its Personal API: fetch is stubbed, so
 * nothing reaches lunchflow.app. Fictional keys and data only. The clock is frozen at
 * 2026-10-01 noon in Toronto.
 */
const KEY = "lf-fictional-integration-key";
const API = "https://www.lunchflow.app/api/v1";

interface FakeRow {
  id: string;
  amount: number | string;
  date: string;
  merchant: string | null;
  description: string;
  isPending?: boolean;
}

interface FakeAccount {
  id: number;
  connection_id: number;
  name: string;
  institution_name: string;
  currency?: string;
  status: string;
  balance: number | string;
  rows: FakeRow[];
}

/** A fictional Neo card owing $523.10 (one purchase still pending) and an everyday account. */
function neo(): FakeAccount[] {
  return [
    {
      id: 9001,
      connection_id: 501,
      name: "Fictional Neo Mastercard",
      institution_name: "Fictional Neo Financial",
      status: "ACTIVE",
      balance: -523.1,
      rows: [
        { id: "lf-1001", amount: -5.25, date: "2026-09-29", merchant: "Fictional Corner Cafe", description: "FICTIONAL CORNER CAFE MONTREAL QC" },
        { id: "lf-1002", amount: "-87.34", date: "2026-09-26", merchant: "Fictional Grocer", description: "FICTIONAL GROCER #12" },
        { id: "lf-1003", amount: 300, date: "2026-09-28", merchant: null, description: "PAYMENT - THANK YOU" },
        { id: "lf-1004", amount: -41.17, date: "2026-10-01", merchant: "Fictional Bistro", description: "FICTIONAL BISTRO", isPending: true },
      ],
    },
    {
      id: 9002,
      connection_id: 501,
      name: "Fictional Everyday Account",
      institution_name: "Fictional Neo Financial",
      currency: "CAD",
      status: "ACTIVE",
      balance: "1840.25",
      rows: [
        { id: "lf-2001", amount: 2000, date: "2026-09-21", merchant: "Fictional Employer", description: "PAYROLL FICTIONAL EMPLOYER" },
        { id: "lf-2002", amount: -300, date: "2026-09-28", merchant: null, description: "TRANSFER TO CARD" },
      ],
    },
  ];
}

const lunchFlow = { key: KEY, accounts: neo(), requests: 0 };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!url.href.startsWith(`${API}/`)) throw new Error(`Unexpected request to ${url.origin}`);
  lunchFlow.requests++;
  if (new Headers(init?.headers).get("x-api-key") !== lunchFlow.key) return json(401, { error: "Unauthorized" });
  const path = url.pathname.slice("/api/v1".length);
  if (path === "/accounts") {
    const accounts = lunchFlow.accounts.map((a) => ({ id: a.id, connection_id: a.connection_id, name: a.name, institution_name: a.institution_name, currency: a.currency, status: a.status }));
    return json(200, { accounts, total: accounts.length });
  }
  const m = /^\/accounts\/(\d+)\/(balance|transactions)$/.exec(path);
  const account = m ? lunchFlow.accounts.find((a) => a.id === Number(m[1])) : undefined;
  if (!m || !account) return json(404, { error: "Not Found" });
  if (m[2] === "balance") return json(200, { balance: { amount: account.balance, currency: account.currency ?? "CAD" } });
  const from = url.searchParams.get("from") ?? "0000-01-01";
  const to = url.searchParams.get("to") ?? "9999-12-31";
  const withPending = url.searchParams.get("include_pending") === "true";
  const rows = account.rows
    .filter((r) => r.date >= from && r.date <= to && (withPending || !r.isPending))
    .map((r) => ({ ...r, accountId: account.id, currency: account.currency ?? "CAD", isPending: Boolean(r.isPending) }));
  return json(200, { transactions: rows, total: rows.length });
}

const person = (user: { id: string }, isDemo = false) => ({ id: user.id, isDemo });
const both = [
  { providerAccountId: "9001", action: "new", type: "CREDIT_CARD" },
  { providerAccountId: "9002", action: "new", type: "CHEQUING" },
] as const;

async function accountsOf(userId: string) {
  const rows = await prisma.account.findMany({ where: { userId }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map((a) => ({
    name: a.name,
    type: a.type,
    isManual: a.isManual,
    status: a.status,
    providerAccountId: a.providerAccountId,
    balance: Number(a.currentBalanceCents),
    available: a.availableBalanceCents === null ? null : Number(a.availableBalanceCents),
  }));
}

async function transactionsOf(userId: string) {
  const rows = await prisma.transaction.findMany({ where: { userId }, orderBy: [{ date: "asc" }, { amountCents: "asc" }] });
  return rows.map((t) => [t.date.toISOString().slice(0, 10), t.description, Number(t.amountCents), t.providerTransactionId] as const);
}

beforeAll(() => {
  freezeTime("2026-10-01T16:00:00Z");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

beforeEach(() => {
  lunchFlow.key = KEY;
  lunchFlow.accounts = neo();
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("checking a key", () => {
  it("lists what the key can read, and the accounts it could continue, without saving anything", async () => {
    const user = await createUser({ firstName: "Robin" });
    const csvCard = await manualAccount(user.id, { name: "Fictional Neo card", type: "CREDIT_CARD" });
    const preview = await previewLunchFlow(person(user), KEY);
    expect(preview.accounts).toEqual([
      {
        providerAccountId: "9001",
        name: "Fictional Neo Mastercard",
        institution: "Fictional Neo Financial",
        currency: "CAD",
        balanceCents: -52310,
        suggestedType: "CREDIT_CARD",
        active: true,
        existing: null,
        skipped: false,
        supported: true,
      },
      {
        providerAccountId: "9002",
        name: "Fictional Everyday Account",
        institution: "Fictional Neo Financial",
        currency: "CAD",
        balanceCents: 184025,
        suggestedType: "CHEQUING",
        active: true,
        existing: null,
        skipped: false,
        supported: true,
      },
    ]);
    expect(preview.linkable).toEqual([{ id: csvCard.id, name: "Fictional Neo card", type: "CREDIT_CARD", currency: "CAD", institution: null, transactionCount: 0 }]);
    expect(await prisma.providerConnection.count({ where: { userId: user.id } })).toBe(0);
  });

  it("reports a key Lunch Flow refuses", async () => {
    const user = await createUser();
    await expect(previewLunchFlow(person(user), "lf-fictional-wrong-key")).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it("says so when the key shares no accounts", async () => {
    const user = await createUser();
    lunchFlow.accounts = [];
    await expect(previewLunchFlow(person(user), KEY)).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("didn't share any accounts") });
  });

  it("keeps the shared demo account from connecting anything", async () => {
    const user = await createUser();
    const before = lunchFlow.requests;
    await expect(previewLunchFlow(person(user, true), KEY)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(connectLunchFlow(person(user, true), KEY, [...both])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(lunchFlow.requests).toBe(before);
  });

  it("leaves out accounts in a currency Harbour can't add yet", async () => {
    const user = await createUser();
    lunchFlow.accounts.push({ id: 9003, connection_id: 501, name: "Fictional US Dollar Account", institution_name: "Fictional Neo Financial", currency: "USD", status: "ACTIVE", balance: 10, rows: [] });
    const preview = await previewLunchFlow(person(user), KEY);
    expect(preview.accounts.map((a) => [a.providerAccountId, a.supported])).toEqual([
      ["9001", true],
      ["9002", true],
      ["9003", false],
    ]);
    await expect(connectLunchFlow(person(user), KEY, [...both, { providerAccountId: "9003", action: "new", type: "CHEQUING" }])).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: "Fictional US Dollar Account is in USD, and Harbour only supports CAD accounts for now. Leave it out.",
    });
    expect(await prisma.providerConnection.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("connecting", () => {
  let userId: string;
  let connectionId: string;

  it("saves the key encrypted, with the person's types, and imports the posted transactions", async () => {
    userId = (await createUser()).id;
    const res = await connectLunchFlow(person({ id: userId }), KEY, [...both]);
    expect(res).toEqual({ institution: "Fictional Neo Financial", accounts: 2, added: 5, warning: null });

    const connection = await prisma.providerConnection.findFirstOrThrow({ where: { userId } });
    connectionId = connection.id;
    expect(connection).toMatchObject({ provider: "LUNCHFLOW", status: "ACTIVE", lastSyncError: null, providerItemId: `${userId}:connection:501` });
    expect(connection.encryptedAccessToken).toMatch(/^v1:/);
    expect(connection.encryptedAccessToken).not.toContain(KEY);
    expect(JSON.parse(decryptSecret(connection.encryptedAccessToken!))).toEqual({ v: 1, key: KEY, group: "connection:501", skip: [] });

    // The card's -$523.10 is $523.10 owed. Lunch Flow reports no available balance.
    expect(await accountsOf(userId)).toEqual([
      { name: "Fictional Neo Mastercard", type: "CREDIT_CARD", isManual: false, status: "ACTIVE", providerAccountId: "9001", balance: 52310, available: null },
      { name: "Fictional Everyday Account", type: "CHEQUING", isManual: false, status: "ACTIVE", providerAccountId: "9002", balance: 184025, available: null },
    ]);
    // Posted transactions only: the pending bistro charge comes in once it posts.
    expect(await transactionsOf(userId)).toEqual([
      ["2026-09-21", "PAYROLL FICTIONAL EMPLOYER", 200000, "lf-2001"],
      ["2026-09-26", "FICTIONAL GROCER #12", -8734, "lf-1002"],
      ["2026-09-28", "TRANSFER TO CARD", -30000, "lf-2002"],
      ["2026-09-28", "PAYMENT - THANK YOU", 30000, "lf-1003"],
      ["2026-09-29", "FICTIONAL CORNER CAFE MONTREAL QC", -525, "lf-1001"],
    ]);

    // The key is in no log.
    const audit = await prisma.auditLog.findMany({ where: { userId } });
    expect(audit.map((a) => a.action)).toContain("account.connected");
    expect(JSON.stringify(audit)).not.toContain(KEY);
    const logs = await prisma.syncLog.findMany({ where: { userId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: "SUCCESS", trigger: "connect", addedCount: 5 });
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });

  it("keeps the person's type and name on later syncs, and follows the balance", async () => {
    // Renamed in Lunch Flow: the name now suggests a chequing account, but the person said credit card.
    lunchFlow.accounts[0]!.name = "Fictional Neo Account";
    lunchFlow.accounts[0]!.balance = "-600.00";
    lunchFlow.accounts[0]!.rows.push({ id: "lf-1005", amount: -76.9, date: "2026-10-01", merchant: "Fictional Pharmacy", description: "FICTIONAL PHARMACY" });
    const outcome = await syncConnection(userId, connectionId, "manual");
    expect(outcome).toMatchObject({ status: "SUCCESS", added: 1 });
    const card = await prisma.account.findFirstOrThrow({ where: { userId, providerAccountId: "9001" } });
    expect(card).toMatchObject({ name: "Fictional Neo Mastercard", officialName: "Fictional Neo Account", type: "CREDIT_CARD" });
    expect(await balanceOf(card.id)).toBe(60000);
  });

  it("adds nothing when syncing again", async () => {
    const before = await prisma.transaction.count({ where: { userId } });
    const outcome = await syncConnection(userId, connectionId, "manual");
    expect(outcome).toMatchObject({ status: "SUCCESS", added: 0 });
    expect(await prisma.transaction.count({ where: { userId } })).toBe(before);
  });
});

describe("the person's account type", () => {
  it("flips a balance and its history when an account moves between an asset and a debt", async () => {
    const user = await createUser();
    // Brought in as a chequing account by mistake: Lunch Flow's -$523.10 reads as an overdraft.
    await connectLunchFlow(person(user), KEY, [
      { providerAccountId: "9001", action: "new", type: "CHEQUING" },
      { providerAccountId: "9002", action: "skip" },
    ]);
    const card = await prisma.account.findFirstOrThrow({ where: { userId: user.id, providerAccountId: "9001" } });
    expect(await balanceOf(card.id)).toBe(-52310);
    const snapshots = async () => (await prisma.accountBalanceSnapshot.findMany({ where: { accountId: card.id }, orderBy: { date: "asc" } })).map((s) => Number(s.balanceCents));
    const netWorth = async () => Number((await prisma.netWorthSnapshot.findFirstOrThrow({ where: { userId: user.id }, orderBy: { date: "desc" } })).netWorthCents);
    const history = await snapshots();
    const worth = await netWorth();
    expect(history.length).toBeGreaterThan(0);

    await updateAccount(user.id, card.id, { type: "CREDIT_CARD" });
    expect(await balanceOf(card.id)).toBe(52310);
    expect(await snapshots()).toEqual(history.map((c) => -c || 0));
    // -$523.10 of cash and $523.10 of debt are the same net worth.
    expect(await netWorth()).toBe(worth);

    // A limit gives the card's available credit, and the next sync keeps both.
    await updateAccount(user.id, card.id, { creditLimitCents: 200000 });
    const connection = await prisma.providerConnection.findFirstOrThrow({ where: { userId: user.id } });
    expect(await syncConnection(user.id, connection.id, "manual")).toMatchObject({ status: "SUCCESS" });
    const synced = await prisma.account.findUniqueOrThrow({ where: { id: card.id } });
    expect({ type: synced.type, balance: Number(synced.currentBalanceCents), limit: Number(synced.creditLimitCents), available: Number(synced.availableBalanceCents) }).toEqual({
      type: "CREDIT_CARD",
      balance: 52310,
      limit: 200000,
      available: 147690,
    });

    // The balance itself still comes from the bank.
    await expect(updateAccount(user.id, card.id, { balanceCents: 1 })).rejects.toMatchObject({ code: "FORBIDDEN", message: "This account's balance comes from your bank." });
  });
});

describe("continuing an account imported from CSV files", () => {
  it("links it and imports only what the files didn't have", async () => {
    const user = await createUser();
    const csvCard = await manualAccount(user.id, { name: "Fictional Neo card", type: "CREDIT_CARD" });
    await seedTransactions(user.id, csvCard.id, [
      { date: "2026-08-22", amountCents: -1999, description: "FICTIONAL BOOKSHOP", isManual: true },
      { date: "2026-09-29", amountCents: -525, description: "FICTIONAL CORNER CAFE", isManual: true },
    ]);
    const preview = await previewLunchFlow(person(user), KEY);
    expect(preview.linkable).toMatchObject([{ id: csvCard.id, transactionCount: 2 }]);

    const res = await connectLunchFlow(person(user), KEY, [
      { providerAccountId: "9001", action: "link", type: "CREDIT_CARD", linkAccountId: csvCard.id },
      { providerAccountId: "9002", action: "skip" },
    ]);
    // The café was already there: only the grocer and the payment are new.
    expect(res).toEqual({ institution: "Fictional Neo Financial", accounts: 1, added: 2, warning: null });
    expect(await accountsOf(user.id)).toEqual([
      { name: "Fictional Neo card", type: "CREDIT_CARD", isManual: false, status: "ACTIVE", providerAccountId: "9001", balance: 52310, available: null },
    ]);
    expect((await transactionsOf(user.id)).map(([date, description, cents]) => [date, description, cents])).toEqual([
      ["2026-08-22", "FICTIONAL BOOKSHOP", -1999],
      ["2026-09-26", "FICTIONAL GROCER #12", -8734],
      ["2026-09-28", "PAYMENT - THANK YOU", 30000],
      ["2026-09-29", "FICTIONAL CORNER CAFE", -525],
    ]);
    const token = JSON.parse(decryptSecret((await prisma.providerConnection.findFirstOrThrow({ where: { userId: user.id } })).encryptedAccessToken!));
    expect(token.skip).toEqual(["9002"]);
  });

  it("refuses choices that don't fit, and saves nothing", async () => {
    const user = await createUser();
    const other = await createUser();
    const theirs = await manualAccount(other.id, { name: "Fictional card of someone else", type: "CREDIT_CARD" });
    const mine = await manualAccount(user.id, { name: "Fictional card", type: "CREDIT_CARD" });

    await expect(connectLunchFlow(person(user), KEY, [{ providerAccountId: "9001", action: "link", type: "CREDIT_CARD", linkAccountId: theirs.id }])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      connectLunchFlow(person(user), KEY, [
        { providerAccountId: "9001", action: "link", type: "CREDIT_CARD", linkAccountId: mine.id },
        { providerAccountId: "9002", action: "link", type: "CHEQUING", linkAccountId: mine.id },
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(connectLunchFlow(person(user), KEY, [{ providerAccountId: "9999", action: "new", type: "CHEQUING" }])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      connectLunchFlow(person(user), KEY, [
        { providerAccountId: "9001", action: "skip" },
        { providerAccountId: "9002", action: "skip" },
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: "Choose at least one account to bring into Harbour." });

    expect(await prisma.providerConnection.count({ where: { userId: { in: [user.id, other.id] } } })).toBe(0);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({ isManual: true, connectionId: null, userId: other.id });
    expect(await prisma.account.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ isManual: true, connectionId: null });
  });
});

describe("pasting a key again", () => {
  it("keeps the connected accounts, remembers the ones left out and adds the ones chosen now", async () => {
    const user = await createUser();
    await connectLunchFlow(person(user), KEY, [
      { providerAccountId: "9001", action: "new", type: "CREDIT_CARD" },
      { providerAccountId: "9002", action: "skip" },
    ]);
    const first = await prisma.providerConnection.findFirstOrThrow({ where: { userId: user.id } });

    const preview = await previewLunchFlow(person(user), KEY);
    expect(preview.accounts.map((a) => [a.providerAccountId, a.existing?.name ?? null, a.skipped])).toEqual([
      ["9001", "Fictional Neo Mastercard", false],
      ["9002", null, true],
    ]);

    // A new key from Lunch Flow replaces the old one.
    lunchFlow.key = "lf-fictional-second-key";
    const res = await connectLunchFlow(person(user), "lf-fictional-second-key", [{ providerAccountId: "9002", action: "new", type: "SAVINGS" }]);
    expect(res).toMatchObject({ accounts: 2, added: 2, warning: null });
    const connections = await prisma.providerConnection.findMany({ where: { userId: user.id } });
    expect(connections.map((c) => c.id)).toEqual([first.id]);
    expect(JSON.parse(decryptSecret(connections[0]!.encryptedAccessToken!))).toEqual({ v: 1, key: "lf-fictional-second-key", group: "connection:501", skip: [] });
    expect((await accountsOf(user.id)).map((a) => [a.providerAccountId, a.type, a.balance])).toEqual([
      ["9001", "CREDIT_CARD", 52310],
      ["9002", "SAVINGS", 184025],
    ]);
    // Each transaction once.
    expect((await transactionsOf(user.id)).map((t) => t[3])).toEqual(["lf-2001", "lf-1002", "lf-2002", "lf-1003", "lf-1001"]);
  });
});

describe("when Lunch Flow stops answering for a connection", () => {
  it("asks to reconnect when the key is refused, and recovers with a new key", async () => {
    const user = await createUser();
    await connectLunchFlow(person(user), KEY, [...both]);
    const connection = await prisma.providerConnection.findFirstOrThrow({ where: { userId: user.id } });

    lunchFlow.key = "lf-fictional-rotated-key";
    const outcome = await syncConnection(user.id, connection.id, "scheduled");
    expect(outcome).toMatchObject({ status: "FAILED", message: "Lunch Flow didn't accept the API key. Create a new key in Lunch Flow and paste it into Harbour." });
    expect(await prisma.providerConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({ status: "REQUIRES_REAUTH" });
    expect(await prisma.notification.findFirst({ where: { userId: user.id, type: "SYNC_FAILURE" } })).toMatchObject({ title: "Reconnect your bank" });
    // Balances stay as they were rather than dropping to zero.
    expect((await accountsOf(user.id)).map((a) => a.balance)).toEqual([52310, 184025]);

    // Reconnecting with the new key: same connection and accounts, nothing copied.
    const res = await connectLunchFlow(person(user), "lf-fictional-rotated-key", []);
    expect(res).toMatchObject({ accounts: 2, added: 0, warning: null });
    expect(await prisma.providerConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({ status: "ACTIVE", lastSyncError: null });
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(2);
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(5);
  });

  it("reports a bank link that's down in Lunch Flow, and a bank Lunch Flow no longer shares", async () => {
    const user = await createUser();
    await connectLunchFlow(person(user), KEY, [...both]);
    const connection = await prisma.providerConnection.findFirstOrThrow({ where: { userId: user.id } });

    for (const a of lunchFlow.accounts) a.status = "DISCONNECTED";
    expect(await syncConnection(user.id, connection.id, "scheduled")).toMatchObject({
      status: "FAILED",
      message: "Lunch Flow has lost its connection to Fictional Neo Financial. Reconnect it in Lunch Flow, and Harbour will catch up on the next sync.",
    });
    expect(await prisma.providerConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({ status: "ERROR" });

    lunchFlow.accounts = [];
    expect(await syncConnection(user.id, connection.id, "scheduled")).toMatchObject({ status: "FAILED", message: expect.stringContaining("no longer shares this bank's accounts") });
    expect(await prisma.providerConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({ status: "REQUIRES_REAUTH" });
    expect((await accountsOf(user.id)).map((a) => a.balance)).toEqual([52310, 184025]);
  });
});

describe("disconnecting", () => {
  it("forgets the key and keeps the history, and pasting the key again picks the same accounts back up", async () => {
    const user = await createUser();
    await connectLunchFlow(person(user), KEY, [...both]);
    const connection = await prisma.providerConnection.findFirstOrThrow({ where: { userId: user.id } });

    await disconnectConnection(user.id, connection.id);
    expect(await prisma.providerConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({ status: "DISCONNECTED", encryptedAccessToken: null });
    expect((await accountsOf(user.id)).map((a) => a.status)).toEqual(["DISCONNECTED", "DISCONNECTED"]);
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(5);

    const preview = await previewLunchFlow(person(user), KEY);
    expect(preview.accounts.every((a) => a.existing)).toBe(true);
    expect(await connectLunchFlow(person(user), KEY, [])).toMatchObject({ accounts: 2, added: 0, warning: null });
    expect((await accountsOf(user.id)).map((a) => a.status)).toEqual(["ACTIVE", "ACTIVE"]);
    expect(await prisma.providerConnection.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(5);
  });
});
