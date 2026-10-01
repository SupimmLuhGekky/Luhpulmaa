import "server-only";
import type { AccountType, ProviderType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AppError, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { addDays, fromDbDate, todayIn, toDbDate, type LocalDate } from "@/lib/dates";
import { toCents, type Cents } from "@/lib/finance/money";
import { encryptSecret, decryptSecret } from "@/lib/security/encryption";
import { getDefaultProvider, getProvider } from "@/lib/banking/registry";
import { ProviderError } from "@/lib/banking/types";
import { MOCK_INSTITUTIONS } from "@/lib/banking/providers/mock-data";
import { isEnabled } from "@/lib/flags";
import { syncConnection } from "@/lib/sync/service";
import { recordNetWorthSnapshot } from "@/lib/networth/service";
import { isLiability, manualAvailableBalance } from "./types";
import type { accountUpdateSchema, manualAccountSchema } from "./schemas";

export { ACCOUNT_TYPES, accountUpdateSchema, manualAccountSchema } from "./schemas";

const accountSelect = {
  id: true,
  name: true,
  officialName: true,
  mask: true,
  type: true,
  currency: true,
  currentBalanceCents: true,
  availableBalanceCents: true,
  creditLimitCents: true,
  isManual: true,
  isHidden: true,
  includeInNetWorth: true,
  status: true,
  lastSyncedAt: true,
  displayOrder: true,
  connectionId: true,
  institution: { select: { id: true, name: true, primaryColor: true, provider: true } },
  connection: { select: { id: true, status: true, provider: true, lastSyncedAt: true, lastSyncError: true } },
} as const;

export interface AccountDTO {
  id: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: AccountType;
  currency: string;
  currentBalanceCents: Cents;
  availableBalanceCents: Cents | null;
  creditLimitCents: Cents | null;
  isManual: boolean;
  isHidden: boolean;
  includeInNetWorth: boolean;
  isLiability: boolean;
  status: string;
  lastSyncedAt: string | null;
  institution: { id: string; name: string; primaryColor: string | null } | null;
  connection: { id: string; status: string; provider: string; lastSyncError: string | null } | null;
  isSimulated: boolean;
}

type AccountRow = Awaited<ReturnType<typeof prisma.account.findFirstOrThrow<{ select: typeof accountSelect }>>>;

function toDTO(a: AccountRow): AccountDTO {
  return {
    id: a.id,
    name: a.name,
    officialName: a.officialName,
    mask: a.mask,
    type: a.type,
    currency: a.currency,
    currentBalanceCents: toCents(a.currentBalanceCents),
    availableBalanceCents: a.availableBalanceCents === null ? null : toCents(a.availableBalanceCents),
    creditLimitCents: a.creditLimitCents === null ? null : toCents(a.creditLimitCents),
    isManual: a.isManual,
    isHidden: a.isHidden,
    includeInNetWorth: a.includeInNetWorth,
    isLiability: isLiability(a.type),
    status: a.status,
    lastSyncedAt: (a.lastSyncedAt ?? a.connection?.lastSyncedAt)?.toISOString() ?? null,
    institution: a.institution ? { id: a.institution.id, name: a.institution.name, primaryColor: a.institution.primaryColor } : null,
    connection: a.connection ? { id: a.connection.id, status: a.connection.status, provider: a.connection.provider, lastSyncError: a.connection.lastSyncError } : null,
    isSimulated: a.connection?.provider === "MOCK",
  };
}

export async function listAccounts(userId: string, opts: { includeHidden?: boolean } = {}) {
  const rows = await prisma.account.findMany({
    where: { userId, ...(opts.includeHidden ? {} : { isHidden: false }), status: { not: "CLOSED" } },
    select: accountSelect,
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDTO);
}

export async function getAccount(userId: string, id: string) {
  const row = await prisma.account.findFirst({ where: { id, userId }, select: accountSelect });
  if (!row) throw notFound("Account");
  return toDTO(row);
}

export async function accountDetail(userId: string, id: string, timeZone: string) {
  const account = await getAccount(userId, id);
  const today = todayIn(timeZone);
  const from = addDays(today, -90);
  const [snapshots, flows] = await Promise.all([
    prisma.accountBalanceSnapshot.findMany({ where: { userId, accountId: id, date: { gte: toDbDate(addDays(today, -365)) } }, orderBy: { date: "asc" }, select: { date: true, balanceCents: true } }),
    prisma.transaction.groupBy({
      by: ["type"],
      where: { userId, accountId: id, date: { gte: toDbDate(from) }, isExcluded: false },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
  ]);
  let income = 0;
  let spending = 0;
  let count = 0;
  for (const f of flows) {
    const v = toCents(f._sum.amountCents);
    count += f._count._all;
    if (f.type === "INCOME") income += v;
    if (f.type === "EXPENSE" || f.type === "REFUND") spending += -v;
  }
  const history = snapshots.map((s) => ({ date: fromDbDate(s.date), balance: toCents(s.balanceCents) }));
  // Today's point is always the current balance (manual transactions can move it after the day's snapshot).
  const last = history[history.length - 1];
  if (last?.date === today) last.balance = account.currentBalanceCents;
  else history.push({ date: today, balance: account.currentBalanceCents });
  return { account, history, last90: { income, spending, count, from } };
}

export async function createManualAccount(userId: string, input: z.infer<typeof manualAccountSchema>) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true, currency: true } });
  // Without multi-currency support, totals add balances as-is, so every account uses the user's currency.
  if (input.currency !== user.currency && !isEnabled("ENABLE_MULTI_CURRENCY")) {
    const message = `Accounts in other currencies aren't supported yet. Use ${user.currency}.`;
    throw new AppError("VALIDATION_FAILED", message, { fieldErrors: { currency: [message] } });
  }
  let institutionId: string | null = null;
  if (input.institutionName) {
    const inst = await prisma.institution.upsert({
      where: { provider_providerInstitutionId: { provider: "MANUAL", providerInstitutionId: input.institutionName.toLowerCase() } },
      update: {},
      create: { provider: "MANUAL", providerInstitutionId: input.institutionName.toLowerCase(), name: input.institutionName },
    });
    institutionId = inst.id;
  }
  const count = await prisma.account.count({ where: { userId } });
  const account = await prisma.account.create({
    data: {
      userId,
      name: input.name,
      type: input.type,
      currency: input.currency,
      currentBalanceCents: input.balanceCents,
      availableBalanceCents: manualAvailableBalance(input.type, input.balanceCents, input.creditLimitCents),
      creditLimitCents: input.creditLimitCents ?? null,
      mask: input.mask || null,
      isManual: true,
      institutionId,
      displayOrder: count,
    },
  });
  const today = todayIn(user.timeZone);
  await prisma.accountBalanceSnapshot.create({ data: { userId, accountId: account.id, date: toDbDate(today), balanceCents: input.balanceCents } });
  await recordNetWorthSnapshot(userId, today);
  await audit(userId, "account.created", { type: "account", id: account.id }, { type: input.type, manual: true });
  return account;
}

async function userToday(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  return todayIn(user.timeZone);
}

export async function updateAccount(userId: string, id: string, input: z.infer<typeof accountUpdateSchema>) {
  const existing = await prisma.account.findFirst({ where: { id, userId } });
  if (!existing) throw notFound("Account");
  const bankOwned = input.balanceCents !== undefined || input.type !== undefined || input.creditLimitCents !== undefined;
  if (bankOwned && !existing.isManual) {
    throw new AppError("FORBIDDEN", "Balances, types and credit limits of connected accounts come from your bank.");
  }
  // Keep the stored available balance consistent with the (possibly new) type, balance and limit.
  const type = input.type ?? existing.type;
  const balance = input.balanceCents ?? toCents(existing.currentBalanceCents);
  const limit = input.creditLimitCents !== undefined ? input.creditLimitCents : existing.creditLimitCents === null ? null : toCents(existing.creditLimitCents);
  const account = await prisma.account.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.isHidden !== undefined ? { isHidden: input.isHidden } : {}),
      ...(input.includeInNetWorth !== undefined ? { includeInNetWorth: input.includeInNetWorth } : {}),
      ...(input.balanceCents !== undefined ? { currentBalanceCents: input.balanceCents } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.creditLimitCents !== undefined ? { creditLimitCents: input.creditLimitCents } : {}),
      ...(bankOwned ? { availableBalanceCents: manualAvailableBalance(type, balance, limit) } : {}),
    },
  });
  if (input.balanceCents !== undefined || input.type !== undefined || input.includeInNetWorth !== undefined) {
    const today = await userToday(userId);
    if (input.balanceCents !== undefined) {
      await prisma.accountBalanceSnapshot.upsert({
        where: { accountId_date: { accountId: id, date: toDbDate(today) } },
        update: { balanceCents: input.balanceCents },
        create: { userId, accountId: id, date: toDbDate(today), balanceCents: input.balanceCents },
      });
    }
    // Balance, asset/debt type and "include in net worth" all change today's net worth.
    await recordNetWorthSnapshot(userId, today);
  }
  await audit(userId, "account.updated", { type: "account", id }, { fields: Object.keys(input) });
  return account;
}

/** Deletes a manual account and all its transactions (connected accounts are disconnected instead). */
export async function deleteManualAccount(userId: string, id: string) {
  const existing = await prisma.account.findFirst({ where: { id, userId } });
  if (!existing) throw notFound("Account");
  if (!existing.isManual) throw new AppError("FORBIDDEN", "Disconnect the bank connection to remove this account.");
  await prisma.account.delete({ where: { id } });
  await recordNetWorthSnapshot(userId, await userToday(userId));
  await audit(userId, "account.deleted", { type: "account", id });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bank connections
// ─────────────────────────────────────────────────────────────────────────────

export async function createLinkSession(userId: string, reconnectConnectionId?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { locale: true } });
  const language = user.locale.startsWith("fr") ? ("fr" as const) : ("en" as const);
  if (reconnectConnectionId) {
    const c = await prisma.providerConnection.findFirst({ where: { id: reconnectConnectionId, userId } });
    if (!c) throw notFound("Connection");
    const provider = getProvider(c.provider);
    return provider.createLinkSession(userId, { reconnectItemId: c.providerItemId, accessToken: c.encryptedAccessToken ? decryptSecret(c.encryptedAccessToken) : undefined, language });
  }
  const provider = getDefaultProvider();
  if (!provider.isConfigured()) throw new ProviderError("NOT_CONFIGURED", "Bank connections aren't configured on this server yet. You can import a CSV file or add accounts manually.");
  return provider.createLinkSession(userId, { language });
}

export function mockInstitutions() {
  return MOCK_INSTITUTIONS.map((i) => ({ id: i.id, name: i.name, color: i.color }));
}

/**
 * Completes a provider link: exchanges the public token, stores the encrypted access
 * token, then runs the first sync (accounts, balances, transactions, categorisation).
 */
export async function completeConnection(userId: string, publicToken: string, metadata?: Record<string, unknown>, opts: { providerType?: ProviderType } = {}) {
  // Only the demo seeder picks a provider explicitly (always MOCK); users get the configured one.
  const provider = opts.providerType ? getProvider(opts.providerType) : getDefaultProvider();
  const exchange = await provider.exchangePublicToken(userId, publicToken, metadata);
  // Never touch a connection that belongs to someone else (checked before any write).
  const existing = await prisma.providerConnection.findUnique({
    where: { provider_providerItemId: { provider: provider.id, providerItemId: exchange.providerItemId } },
    select: { userId: true },
  });
  if (existing && existing.userId !== userId) throw new AppError("FORBIDDEN", "This connection belongs to another user.");
  const institution = await prisma.institution.upsert({
    where: { provider_providerInstitutionId: { provider: provider.id, providerInstitutionId: exchange.institution.providerInstitutionId } },
    update: { name: exchange.institution.name, primaryColor: exchange.institution.primaryColor ?? undefined },
    create: { provider: provider.id, providerInstitutionId: exchange.institution.providerInstitutionId, name: exchange.institution.name, country: exchange.institution.country ?? "CA", primaryColor: exchange.institution.primaryColor ?? null },
  });
  const connection = await prisma.providerConnection.upsert({
    where: { provider_providerItemId: { provider: provider.id, providerItemId: exchange.providerItemId } },
    update: { encryptedAccessToken: encryptSecret(exchange.accessToken), status: "ACTIVE", lastSyncError: null, institutionId: institution.id },
    create: { userId, provider: provider.id, providerItemId: exchange.providerItemId, institutionId: institution.id, encryptedAccessToken: encryptSecret(exchange.accessToken) },
  });
  await audit(userId, "account.connected", { type: "connection", id: connection.id }, { provider: provider.id, institution: institution.name });
  const sync = await syncConnection(userId, connection.id, "connect");
  const accounts = await prisma.account.count({ where: { connectionId: connection.id } });
  return { connectionId: connection.id, institution: institution.name, accounts, sync };
}

/** The ENABLE_BANKING kill switch also stops manual syncs, like the daily job. */
function assertBankingEnabled() {
  if (!isEnabled("ENABLE_BANKING")) throw new ProviderError("NOT_CONFIGURED", "Bank connections are turned off on this server.");
}

export async function syncAccount(userId: string, accountId: string) {
  const account = await prisma.account.findFirst({ where: { id: accountId, userId }, select: { connectionId: true, isManual: true } });
  if (!account) throw notFound("Account");
  if (!account.connectionId) throw new AppError("BAD_REQUEST", "Manual accounts don't sync. Update the balance instead.");
  assertBankingEnabled();
  return syncConnection(userId, account.connectionId, "manual");
}

/** "Sync now" for a whole connection (every account at that institution). */
export async function syncConnectionNow(userId: string, connectionId: string) {
  const c = await prisma.providerConnection.findFirst({ where: { id: connectionId, userId }, select: { id: true } });
  if (!c) throw notFound("Connection");
  assertBankingEnabled();
  return syncConnection(userId, c.id, "manual");
}

/**
 * Simulated (MOCK) connections have no bank sign-in to repeat: reconnecting re-links
 * the same demo institution, which reactivates the connection and its accounts.
 */
export async function reconnectSimulatedConnection(userId: string, connectionId: string) {
  const c = await prisma.providerConnection.findFirst({ where: { id: connectionId, userId }, select: { provider: true, institution: { select: { providerInstitutionId: true } } } });
  if (!c) throw notFound("Connection");
  if (c.provider !== "MOCK" || !c.institution) throw new AppError("BAD_REQUEST", "Reconnect this bank through its secure sign-in window.");
  assertBankingEnabled();
  return completeConnection(userId, `mock-public:${c.institution.providerInstitutionId}`, undefined, { providerType: "MOCK" });
}

/**
 * Disconnects a provider connection: revokes the token at the provider, deletes the
 * stored token, and marks accounts disconnected. History is kept unless `deleteData`.
 */
export async function disconnectConnection(userId: string, connectionId: string, deleteData = false) {
  const c = await prisma.providerConnection.findFirst({ where: { id: connectionId, userId } });
  if (!c) throw notFound("Connection");
  if (c.encryptedAccessToken) {
    try {
      await getProvider(c.provider).disconnectAccount(decryptSecret(c.encryptedAccessToken));
    } catch {
      console.warn("[accounts] provider revoke failed; removing local token anyway");
    }
  }
  if (deleteData) {
    await prisma.account.deleteMany({ where: { userId, connectionId } });
    await prisma.providerConnection.delete({ where: { id: connectionId } });
    await recordNetWorthSnapshot(userId, await userToday(userId));
  } else {
    await prisma.$transaction([
      prisma.providerConnection.update({ where: { id: connectionId }, data: { status: "DISCONNECTED", encryptedAccessToken: null, syncCursor: null } }),
      prisma.account.updateMany({ where: { userId, connectionId }, data: { status: "DISCONNECTED" } }),
    ]);
  }
  await audit(userId, "account.disconnected", { type: "connection", id: connectionId }, { deleteData });
}

export async function listConnections(userId: string) {
  const rows = await prisma.providerConnection.findMany({
    where: { userId },
    include: { institution: { select: { name: true, primaryColor: true } }, _count: { select: { accounts: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((c) => ({
    id: c.id,
    provider: c.provider,
    status: c.status,
    institution: c.institution?.name ?? "Unknown institution",
    color: c.institution?.primaryColor ?? null,
    lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: c.lastSyncError,
    accountCount: c._count.accounts,
    createdAt: c.createdAt.toISOString(),
  }));
}

/** Cash available in spending accounts (for safe-to-spend and dashboard). */
export async function cashTotals(userId: string, includeSavings: boolean) {
  const accounts = await prisma.account.findMany({ where: { userId, status: { not: "CLOSED" }, type: { in: ["CHEQUING", "SAVINGS", "CASH"] } }, select: { id: true, name: true, type: true, currentBalanceCents: true, availableBalanceCents: true, isHidden: true } });
  const spendable = accounts.filter((a) => a.type !== "SAVINGS" || includeSavings);
  const available = spendable.reduce((acc, a) => acc + toCents(a.availableBalanceCents ?? a.currentBalanceCents), 0);
  const total = accounts.reduce((acc, a) => acc + toCents(a.currentBalanceCents), 0);
  return { available, total, accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: toCents(a.currentBalanceCents), isHidden: a.isHidden })) };
}

export type { LocalDate };
