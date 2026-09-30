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
import { syncConnection } from "@/lib/sync/service";
import { recordNetWorthSnapshot } from "@/lib/networth/service";
import { isLiability } from "./types";

export const ACCOUNT_TYPES = ["CHEQUING", "SAVINGS", "CASH", "CREDIT_CARD", "LINE_OF_CREDIT", "LOAN", "MORTGAGE", "INVESTMENT", "OTHER_ASSET", "OTHER_LIABILITY"] as const;

export const manualAccountSchema = z.object({
  name: z.string().trim().min(1, "Required").max(60),
  type: z.enum(ACCOUNT_TYPES),
  institutionName: z.string().trim().max(60).optional(),
  currency: z.enum(["CAD", "USD", "EUR", "GBP"]).default("CAD"),
  /** Assets: amount held. Liabilities: amount owed (positive). */
  balanceCents: z.number().int().min(-100_000_000_00).max(100_000_000_00),
  creditLimitCents: z.number().int().min(0).nullable().optional(),
  mask: z.string().trim().regex(/^\d{0,4}$/).optional(),
});

export const accountUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  isHidden: z.boolean().optional(),
  includeInNetWorth: z.boolean().optional(),
  /** Manual accounts only. */
  balanceCents: z.number().int().optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
});

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
  if (!history.length || history[history.length - 1].date !== today) history.push({ date: today, balance: account.currentBalanceCents });
  return { account, history, last90: { income, spending, count, from } };
}

export async function createManualAccount(userId: string, input: z.infer<typeof manualAccountSchema>) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
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
      availableBalanceCents: isLiability(input.type) && input.creditLimitCents ? input.creditLimitCents - input.balanceCents : input.balanceCents,
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

export async function updateAccount(userId: string, id: string, input: z.infer<typeof accountUpdateSchema>) {
  const existing = await prisma.account.findFirst({ where: { id, userId } });
  if (!existing) throw notFound("Account");
  if ((input.balanceCents !== undefined || input.type !== undefined) && !existing.isManual) {
    throw new AppError("FORBIDDEN", "Balances and types of connected accounts come from your bank.");
  }
  const account = await prisma.account.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.isHidden !== undefined ? { isHidden: input.isHidden } : {}),
      ...(input.includeInNetWorth !== undefined ? { includeInNetWorth: input.includeInNetWorth } : {}),
      ...(input.balanceCents !== undefined ? { currentBalanceCents: input.balanceCents, availableBalanceCents: input.balanceCents } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
    },
  });
  if (input.balanceCents !== undefined) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
    const today = todayIn(user.timeZone);
    await prisma.accountBalanceSnapshot.upsert({
      where: { accountId_date: { accountId: id, date: toDbDate(today) } },
      update: { balanceCents: input.balanceCents },
      create: { userId, accountId: id, date: toDbDate(today), balanceCents: input.balanceCents },
    });
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
  await audit(userId, "account.deleted", { type: "account", id });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bank connections
// ─────────────────────────────────────────────────────────────────────────────

export async function createLinkSession(userId: string, reconnectConnectionId?: string) {
  if (reconnectConnectionId) {
    const c = await prisma.providerConnection.findFirst({ where: { id: reconnectConnectionId, userId } });
    if (!c) throw notFound("Connection");
    const provider = getProvider(c.provider);
    return provider.createLinkSession(userId, { reconnectItemId: c.providerItemId, accessToken: c.encryptedAccessToken ? decryptSecret(c.encryptedAccessToken) : undefined });
  }
  const provider = getDefaultProvider();
  if (!provider.isConfigured()) throw new ProviderError("NOT_CONFIGURED", "Bank connections aren't configured on this server yet. You can add accounts manually.");
  return provider.createLinkSession(userId);
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
  if (connection.userId !== userId) throw new AppError("FORBIDDEN", "This connection belongs to another user.");
  await audit(userId, "account.connected", { type: "connection", id: connection.id }, { provider: provider.id, institution: institution.name });
  const sync = await syncConnection(userId, connection.id, "connect");
  const accounts = await prisma.account.count({ where: { connectionId: connection.id } });
  return { connectionId: connection.id, institution: institution.name, accounts, sync };
}

export async function syncAccount(userId: string, accountId: string) {
  const account = await prisma.account.findFirst({ where: { id: accountId, userId }, select: { connectionId: true, isManual: true } });
  if (!account) throw notFound("Account");
  if (!account.connectionId) throw new AppError("BAD_REQUEST", "Manual accounts don't sync. Update the balance instead.");
  return syncConnection(userId, account.connectionId, "manual");
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
