import "server-only";
import type { ProviderConnection } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, fromDbDate, todayIn, toDbDate, type LocalDate } from "@/lib/dates";
import { decryptSecret } from "@/lib/security/encryption";
import { getProvider } from "@/lib/banking/registry";
import { ProviderError, type ProviderAccount, type ProviderTransaction } from "@/lib/banking/types";
import { ingestTransactions } from "@/lib/transactions/ingest";
import { matchTransfers } from "@/lib/transactions/transfers";
import { detectAndPersistRecurring } from "@/lib/recurring/service";
import { recordNetWorthSnapshot } from "@/lib/networth/service";
import { reconstructHistory } from "@/lib/networth/history";
import { notify } from "@/lib/notifications/service";
import { audit } from "@/lib/audit";

/**
 * Synchronisation pipeline for one provider connection:
 *   1. fetch provider accounts + balances          7. detect recurring series
 *   2. upsert normalised accounts, balance history  8. transaction rules/automations (inside ingest)
 *   3. fetch transactions (cursor or date window)   9. refresh analytics snapshots (net worth)
 *   4. normalise + dedupe                          10. account balances (step 2)
 *   5. insert new / replace pending / apply removals 11. write the SyncLog
 *   6. categorise (inside ingest)
 *
 * Idempotent: provider ids are unique per account and every other duplicate path
 * is caught by lib/transactions/dedupe. A connection already syncing is skipped.
 */
const INITIAL_HISTORY_DAYS = 180;
const OVERLAP_DAYS = 10;
const STALE_RUNNING_MS = 10 * 60_000;

export interface SyncOutcome {
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  added: number;
  modified: number;
  removed: number;
  duplicates: number;
  message?: string;
}

async function upsertAccounts(userId: string, connection: ProviderConnection, accounts: ProviderAccount[], today: LocalDate) {
  const map = new Map<string, string>();
  for (const [index, a] of accounts.entries()) {
    const row = await prisma.account.upsert({
      where: { connectionId_providerAccountId: { connectionId: connection.id, providerAccountId: a.providerAccountId } },
      update: {
        officialName: a.officialName ?? null,
        mask: a.mask ?? null,
        type: a.type,
        currency: a.currency,
        currentBalanceCents: a.currentBalanceCents,
        availableBalanceCents: a.availableBalanceCents ?? null,
        creditLimitCents: a.creditLimitCents ?? null,
        lastSyncedAt: new Date(),
        status: "ACTIVE",
      },
      create: {
        userId,
        connectionId: connection.id,
        institutionId: connection.institutionId,
        providerAccountId: a.providerAccountId,
        name: a.name,
        officialName: a.officialName ?? null,
        mask: a.mask ?? null,
        type: a.type,
        currency: a.currency,
        currentBalanceCents: a.currentBalanceCents,
        availableBalanceCents: a.availableBalanceCents ?? null,
        creditLimitCents: a.creditLimitCents ?? null,
        lastSyncedAt: new Date(),
        displayOrder: index,
      },
    });
    map.set(a.providerAccountId, row.id);
    await prisma.accountBalanceSnapshot.upsert({
      where: { accountId_date: { accountId: row.id, date: toDbDate(today) } },
      update: { balanceCents: a.currentBalanceCents },
      create: { userId, accountId: row.id, date: toDbDate(today), balanceCents: a.currentBalanceCents },
    });
  }
  return map;
}

function toRows(txns: ProviderTransaction[], accountMap: Map<string, string>) {
  return txns
    .filter((t) => accountMap.has(t.providerAccountId))
    .map((t) => ({
      accountId: accountMap.get(t.providerAccountId)!,
      providerTransactionId: t.providerTransactionId,
      pendingTransactionId: t.pendingTransactionId ?? null,
      date: t.date,
      postedDate: t.postedDate ?? null,
      amountCents: t.amountCents,
      currency: t.currency,
      description: t.description,
      merchantName: t.merchantName ?? null,
      pending: t.pending,
      categoryHint: t.categoryHint ?? null,
    }));
}

export async function syncConnection(userId: string, connectionId: string, trigger: "manual" | "scheduled" | "connect" | "webhook" = "manual"): Promise<SyncOutcome> {
  const connection = await prisma.providerConnection.findFirst({ where: { id: connectionId, userId } });
  if (!connection) throw new ProviderError("INVALID_REQUEST", "Connection not found.");
  if (connection.status === "DISCONNECTED") return { status: "SKIPPED", added: 0, modified: 0, removed: 0, duplicates: 0, message: "This connection is disconnected." };

  const running = await prisma.syncLog.findFirst({ where: { connectionId, status: "RUNNING", startedAt: { gt: new Date(Date.now() - STALE_RUNNING_MS) } } });
  if (running) return { status: "SKIPPED", added: 0, modified: 0, removed: 0, duplicates: 0, message: "A sync is already in progress." };

  const log = await prisma.syncLog.create({ data: { userId, connectionId, provider: connection.provider, trigger } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const today = todayIn(user.timeZone);
  const outcome: SyncOutcome = { status: "SUCCESS", added: 0, modified: 0, removed: 0, duplicates: 0 };

  try {
    if (!connection.encryptedAccessToken) throw new ProviderError("LOGIN_REQUIRED", "This connection needs to be re-linked.");
    const provider = getProvider(connection.provider);
    const token = decryptSecret(connection.encryptedAccessToken);

    const providerAccounts = await provider.getBalances(token);
    const accountMap = await upsertAccounts(userId, connection, providerAccounts, today);

    // Range providers re-read an overlapping window; cursor providers resume from the cursor.
    const lastSynced = connection.lastSyncedAt ? todayIn(user.timeZone, connection.lastSyncedAt) : null;
    const startDate = lastSynced ? addDays(lastSynced, -OVERLAP_DAYS) : addDays(today, -INITIAL_HISTORY_DAYS);
    let cursor = connection.syncCursor;
    const createdIds: string[] = [];
    for (let page = 0; page < 50; page++) {
      const res = await provider.getTransactions(token, { cursor, startDate, endDate: today });
      const ingest = await ingestTransactions(userId, [...toRows(res.added, accountMap), ...toRows(res.modified, accountMap)], { runAutomations: true, notify: trigger !== "connect" });
      createdIds.push(...ingest.created);
      outcome.added += ingest.created.length;
      outcome.modified += ingest.updated.length;
      outcome.duplicates += ingest.duplicates;
      if (res.removed.length) {
        // Only provider-owned, still-pending rows are deleted; posted history is kept.
        const del = await prisma.transaction.deleteMany({ where: { userId, accountId: { in: [...accountMap.values()] }, providerTransactionId: { in: res.removed }, isManual: false } });
        outcome.removed += del.count;
      }
      cursor = res.nextCursor ?? cursor;
      if (!res.hasMore) break;
    }

    // Pending transactions that the provider no longer reports within the window have expired.
    const windowPending = await prisma.transaction.findMany({
      where: { userId, accountId: { in: [...accountMap.values()] }, isPending: true, date: { lt: toDbDate(addDays(today, -7)) } },
      select: { id: true },
    });
    if (windowPending.length) {
      const del = await prisma.transaction.deleteMany({ where: { id: { in: windowPending.map((p) => p.id) } } });
      outcome.removed += del.count;
    }

    if (createdIds.length) {
      await matchTransfers(userId, addDays(today, -INITIAL_HISTORY_DAYS));
      await detectAndPersistRecurring(userId, { today });
    }
    await recordNetWorthSnapshot(userId, today);
    // First sync: rebuild balance and net-worth history from the imported transactions.
    if (!connection.lastSyncedAt) await reconstructHistory(userId, [...accountMap.values()], today, INITIAL_HISTORY_DAYS);

    await prisma.providerConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: new Date(), lastSyncError: null, status: "ACTIVE", syncCursor: cursor } });
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: "SUCCESS", finishedAt: new Date(), addedCount: outcome.added, modifiedCount: outcome.modified, removedCount: outcome.removed, duplicateCount: outcome.duplicates },
    });
    if (trigger === "manual") await audit(userId, "account.synced", { type: "connection", id: connection.id }, { added: outcome.added });
    return outcome;
  } catch (error) {
    const pe = error instanceof ProviderError ? error : null;
    const message = pe?.message ?? "We couldn't refresh this connection. Please try again later.";
    if (!pe) console.error("[sync] unexpected failure", connection.id, error instanceof Error ? error.message : "unknown");
    await prisma.syncLog.update({ where: { id: log.id }, data: { status: "FAILED", finishedAt: new Date(), errorCode: pe?.code ?? "UNKNOWN", errorMessage: message, addedCount: outcome.added } });
    await prisma.providerConnection.update({
      where: { id: connection.id },
      data: { lastSyncError: message, status: pe?.code === "LOGIN_REQUIRED" ? "REQUIRES_REAUTH" : pe?.retryable ? connection.status : "ERROR" },
    });
    await notify(userId, {
      type: "SYNC_FAILURE",
      severity: "WARNING",
      title: pe?.code === "LOGIN_REQUIRED" ? "Reconnect your bank" : "An account couldn't be refreshed",
      body: message,
      href: "/accounts",
      dedupeKey: `sync-failure:${connection.id}:${today}`,
    });
    return { ...outcome, status: "FAILED", message };
  }
}

export async function syncAllForUser(userId: string, trigger: "manual" | "scheduled" = "manual") {
  const connections = await prisma.providerConnection.findMany({ where: { userId, status: { in: ["ACTIVE", "ERROR"] } }, select: { id: true } });
  const results = [];
  for (const c of connections) results.push({ connectionId: c.id, ...(await syncConnection(userId, c.id, trigger)) });
  return results;
}

export async function recentSyncLogs(userId: string, take = 20) {
  const logs = await prisma.syncLog.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, take, include: { connection: { select: { institution: { select: { name: true } } } } } });
  return logs.map((l) => ({
    id: l.id,
    provider: l.provider,
    trigger: l.trigger,
    status: l.status,
    startedAt: l.startedAt.toISOString(),
    finishedAt: l.finishedAt?.toISOString() ?? null,
    added: l.addedCount,
    modified: l.modifiedCount,
    removed: l.removedCount,
    duplicates: l.duplicateCount,
    errorMessage: l.errorMessage,
    institution: l.connection?.institution?.name ?? null,
  }));
}

export { fromDbDate };
