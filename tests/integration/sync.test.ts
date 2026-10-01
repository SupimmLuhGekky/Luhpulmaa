import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { completeConnection, disconnectConnection, syncAccount } from "@/lib/accounts/service";
import { syncConnection } from "@/lib/sync/service";
import { getProvider } from "@/lib/banking/registry";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { createManualTransaction, updateTransaction } from "@/lib/transactions/service";
import { balanceOf, categoryId, createUser, freezeTime } from "./helpers/factory";

/**
 * Bank connections against the simulated MOCK provider (no network). The clock is
 * frozen at 2026-10-01 noon in Toronto and moved forward to exercise later syncs.
 */
let userId: string;
let connectionId: string;

/** What the simulated bank reports for a window, keyed "<provider account>|<provider transaction id>". */
async function providerTransactions(connId: string, startDate: string, endDate: string) {
  const c = await prisma.providerConnection.findUniqueOrThrow({ where: { id: connId } });
  const page = await getProvider("MOCK").getTransactions(decryptSecret(c.encryptedAccessToken!), { startDate, endDate });
  return page.added.map((t) => ({ ...t, key: `${t.providerAccountId}|${t.providerTransactionId}` }));
}

/** Stored transactions of a connection with the same key (provider ids are unique per account). */
async function connectionTransactions(connId: string) {
  const rows = await prisma.transaction.findMany({
    where: { userId, account: { connectionId: connId } },
    include: { account: { select: { providerAccountId: true } } },
    orderBy: [{ date: "asc" }, { providerTransactionId: "asc" }],
  });
  return rows.map((t) => ({ ...t, key: `${t.account.providerAccountId}|${t.providerTransactionId}` }));
}

const keys = (rows: { key: string }[]) => rows.map((r) => r.key).sort();

beforeAll(async () => {
  freezeTime("2026-10-01T16:00:00Z");
  userId = (await createUser({ firstName: "Mathis" })).id;
});

describe("connecting a bank", () => {
  it("creates the accounts and six months of categorised transactions", async () => {
    const res = await completeConnection(userId, "mock-public:mock_maple");
    connectionId = res.connectionId;
    expect(res).toMatchObject({ institution: "Maple Trust (Demo)", sync: { status: "SUCCESS" } });
    expect(res.accounts).toBeGreaterThan(0);
    expect(res.sync.added).toBeGreaterThan(50);

    const connection = await prisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(connection).toMatchObject({ userId, provider: "MOCK", status: "ACTIVE", lastSyncError: null });
    // The access token is stored encrypted, never in clear text.
    expect(connection.encryptedAccessToken).toMatch(/^v1:/);
    expect(connection.encryptedAccessToken).not.toContain("mock:");

    const accounts = await prisma.account.findMany({ where: { connectionId } });
    expect(accounts).toHaveLength(res.accounts);
    expect(accounts.every((a) => a.userId === userId && !a.isManual && a.status === "ACTIVE")).toBe(true);

    // Exactly what the bank reports for the initial 180-day window, with today's and yesterday's still pending.
    const expected = await providerTransactions(connectionId, "2026-04-04", "2026-10-01");
    const stored = await connectionTransactions(connectionId);
    expect(keys(stored)).toEqual(keys(expected));
    expect(res.sync.added).toBe(expected.length);
    expect(keys(stored.filter((t) => t.isPending))).toEqual(keys(expected.filter((t) => t.pending)));
    expect(stored.filter((t) => t.isPending).every((t) => t.providerTransactionId!.startsWith("pd_") && t.date.toISOString() >= "2026-09-30")).toBe(true);
    expect(stored.filter((t) => t.categoryId).length / stored.length).toBeGreaterThan(0.8);

    const log = await prisma.syncLog.findFirstOrThrow({ where: { connectionId } });
    expect(log).toMatchObject({ status: "SUCCESS", trigger: "connect", addedCount: expected.length });
  });

  it("adds nothing when syncing again the same day", async () => {
    const before = await prisma.transaction.count({ where: { userId } });
    const account = await prisma.account.findFirstOrThrow({ where: { connectionId } });
    const outcome = await syncAccount(userId, account.id);
    expect(outcome).toMatchObject({ status: "SUCCESS", added: 0, modified: 0, removed: 0 });
    expect(outcome.duplicates).toBeGreaterThan(0);
    expect(await prisma.transaction.count({ where: { userId } })).toBe(before);
  });

  it("replaces pending transactions with their posted versions on a later sync, keeping user edits", async () => {
    const pending = (await connectionTransactions(connectionId)).filter((t) => t.isPending);
    expect(pending.length).toBeGreaterThan(0);
    const edited = pending[0];
    await updateTransaction(userId, edited.id, { categoryId: await categoryId(userId, "entertainment"), notes: "fictional note" });

    vi.setSystemTime(new Date("2026-10-04T16:00:00Z"));
    const outcome = await syncConnection(userId, connectionId, "scheduled");
    expect(outcome.status).toBe("SUCCESS");
    expect(outcome.modified).toBe(pending.length);

    // Every transaction the bank reports, once each: nothing duplicated, nothing left pending that has posted.
    const expected = await providerTransactions(connectionId, "2026-04-04", "2026-10-04");
    const stored = await connectionTransactions(connectionId);
    expect(keys(stored)).toEqual(keys(expected));
    expect(keys(stored.filter((t) => t.isPending))).toEqual(keys(expected.filter((t) => t.pending)));

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: edited.id } });
    expect(after).toMatchObject({ isPending: false, categoryId: await categoryId(userId, "entertainment"), notes: "fictional note", categorizedBy: "USER" });
    expect(after.providerTransactionId).toBe(edited.providerTransactionId!.replace(/^pd_/, ""));
  });

  it("keeps the bank's balance when a manual transaction is added to a connected account", async () => {
    const account = await prisma.account.findFirstOrThrow({ where: { connectionId, type: "CHEQUING" } });
    const balance = await balanceOf(account.id);
    await createManualTransaction(userId, { accountId: account.id, date: "2026-10-04", amountCents: -1234, merchantName: "Fictional cash withdrawal note" });
    expect(await balanceOf(account.id)).toBe(balance);
  });
});

describe("disconnecting and reconnecting", () => {
  it("keeps history but removes the token and stops syncing", async () => {
    const before = await prisma.transaction.count({ where: { userId } });
    await disconnectConnection(userId, connectionId);
    expect(await prisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } })).toMatchObject({ status: "DISCONNECTED", encryptedAccessToken: null, syncCursor: null });
    const accounts = await prisma.account.findMany({ where: { connectionId } });
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts.every((a) => a.status === "DISCONNECTED")).toBe(true);
    expect(await prisma.transaction.count({ where: { userId } })).toBe(before);
    expect(await syncAccount(userId, accounts[0].id)).toMatchObject({ status: "SKIPPED" });
  });

  it("reconnecting the same bank days later resumes without duplicating or inventing anything", async () => {
    const bankRows = async () => (await connectionTransactions(connectionId)).filter((t) => !t.isManual);
    const before = await bankRows();
    vi.setSystemTime(new Date("2026-10-06T16:00:00Z"));
    const res = await completeConnection(userId, "mock-public:mock_maple");
    expect(res.connectionId).toBe(connectionId);
    expect(res.sync.status).toBe("SUCCESS");
    expect(await prisma.account.count({ where: { connectionId, status: "ACTIVE" } })).toBe(res.accounts);

    const after = await bankRows();
    // The last sync was on Oct 4, so the bank is re-read from Sep 24: older history is untouched…
    const olderIds = (rows: typeof after) => rows.filter((t) => t.date < new Date("2026-09-24")).map((t) => t.id);
    expect(olderIds(after)).toEqual(olderIds(before));
    // …and the re-read window holds exactly what the bank reports for it, once each.
    const window = await providerTransactions(connectionId, "2026-09-24", "2026-10-06");
    expect(keys(after.filter((t) => t.date >= new Date("2026-09-24")))).toEqual(keys(window));
  });
});

describe("failures", () => {
  it("an institution that is down fails cleanly and writes nothing", async () => {
    const connections = await prisma.providerConnection.count();
    const transactions = await prisma.transaction.count();
    await expect(completeConnection(userId, "mock-public:mock_error")).rejects.toMatchObject({ code: "INSTITUTION_UNAVAILABLE", retryable: true });
    expect(await prisma.providerConnection.count()).toBe(connections);
    expect(await prisma.transaction.count()).toBe(transactions);
    expect(await prisma.institution.count({ where: { providerInstitutionId: "mock_error" } })).toBe(0);
  });

  it("a broken connection records the failure, flags it and notifies the user without touching data", async () => {
    const { connectionId: northern } = await completeConnection(userId, "mock-public:mock_northern");
    const count = await prisma.transaction.count({ where: { userId } });
    await prisma.providerConnection.update({ where: { id: northern }, data: { encryptedAccessToken: encryptSecret("mock:broken") } });

    const outcome = await syncConnection(userId, northern, "manual");
    expect(outcome).toMatchObject({ status: "FAILED", added: 0, message: "Unrecognised demo connection." });
    expect(await prisma.providerConnection.findUniqueOrThrow({ where: { id: northern } })).toMatchObject({ status: "ERROR", lastSyncError: "Unrecognised demo connection." });
    const log = await prisma.syncLog.findFirstOrThrow({ where: { connectionId: northern }, orderBy: { startedAt: "desc" } });
    expect(log).toMatchObject({ status: "FAILED", errorCode: "INVALID_REQUEST" });
    expect(await prisma.notification.count({ where: { userId, type: "SYNC_FAILURE" } })).toBe(1);
    expect(await prisma.transaction.count({ where: { userId } })).toBe(count);

    // Without a token the connection asks to be re-linked.
    await prisma.providerConnection.update({ where: { id: northern }, data: { encryptedAccessToken: null, status: "ACTIVE" } });
    expect(await syncConnection(userId, northern)).toMatchObject({ status: "FAILED" });
    expect(await prisma.providerConnection.findUniqueOrThrow({ where: { id: northern } })).toMatchObject({ status: "REQUIRES_REAUTH" });

    // Disconnecting with "delete data" removes its accounts and transactions only.
    const northernCount = await prisma.transaction.count({ where: { account: { connectionId: northern } } });
    expect(northernCount).toBeGreaterThan(0);
    const total = await prisma.transaction.count({ where: { userId } });
    await disconnectConnection(userId, northern, true);
    expect(await prisma.providerConnection.findUnique({ where: { id: northern } })).toBeNull();
    expect(await prisma.account.count({ where: { connectionId: northern } })).toBe(0);
    expect(await prisma.transaction.count({ where: { userId } })).toBe(total - northernCount);
  });
});
