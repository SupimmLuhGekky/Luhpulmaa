import "server-only";
import type { AccountType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AppError, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { getProvider, lunchFlowAvailable } from "@/lib/banking/registry";
import { decodeLunchFlowToken, encodeLunchFlowToken, slug, type LunchFlowAccount, type LunchFlowProvider } from "@/lib/banking/providers/lunchflow";
import { ProviderError } from "@/lib/banking/types";
import { syncConnection, type SyncOutcome } from "@/lib/sync/service";
import { isLiability } from "./types";
import type { LunchFlowChoice } from "./schemas";

/**
 * Connecting Lunch Flow (see lib/banking/providers/lunchflow.ts). The person pastes an
 * API key; Harbour lists what the key can read; the person says how each account comes
 * in (a new account, an existing manual account it continues, or not at all); Harbour
 * saves one connection per Lunch Flow bank connection and runs the first sync.
 *
 * The key is checked with Lunch Flow at each step and stored only encrypted. It is never
 * sent back to the browser, logged or written to the audit log.
 */

interface Person {
  id: string;
  isDemo: boolean;
}

function lunchFlow(): LunchFlowProvider {
  return getProvider("LUNCHFLOW") as LunchFlowProvider;
}

function assertCanConnect(user: Person) {
  if (!lunchFlowAvailable()) throw new ProviderError("NOT_CONFIGURED", "Bank connections are turned off on this server.");
  if (user.isDemo) throw new AppError("FORBIDDEN", "The shared demo account can't connect real accounts. Sign up for your own Harbour account to use Lunch Flow.");
}

async function discover(apiKey: string): Promise<LunchFlowAccount[]> {
  const accounts = await lunchFlow().discover(apiKey);
  if (!accounts.length) {
    throw new AppError("BAD_REQUEST", "Lunch Flow didn't share any accounts with this key. In Lunch Flow, connect your bank and include its accounts in the API destination, then try again.");
  }
  return accounts;
}

/**
 * Without multi-currency support, totals add balances as they are, so (as for manual
 * accounts) only accounts in the person's own currency can come in.
 */
async function currencyRule(userId: string): Promise<{ currency: string; allows: (currency: string) => boolean }> {
  const { currency } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { currency: true } });
  const multi = isEnabled("ENABLE_MULTI_CURRENCY");
  return { currency, allows: (c) => multi || c === currency };
}

/** Accounts already in Harbour through Lunch Flow, by Lunch Flow account id. */
async function connectedAccounts(userId: string, providerAccountIds: string[]) {
  const rows = await prisma.account.findMany({
    where: { userId, providerAccountId: { in: providerAccountIds }, connection: { userId, provider: "LUNCHFLOW" } },
    select: { id: true, name: true, type: true, providerAccountId: true, connectionId: true },
  });
  return new Map(rows.map((r) => [r.providerAccountId!, r]));
}

/** Accounts the person chose not to import last time (kept in their connections' stored tokens). */
async function previouslySkipped(userId: string): Promise<Set<string>> {
  const connections = await prisma.providerConnection.findMany({ where: { userId, provider: "LUNCHFLOW", encryptedAccessToken: { not: null } }, select: { encryptedAccessToken: true } });
  const skipped = new Set<string>();
  for (const c of connections) {
    try {
      for (const id of decodeLunchFlowToken(decryptSecret(c.encryptedAccessToken!)).skip) skipped.add(id);
    } catch {
      // An unreadable token has nothing to remember.
    }
  }
  return skipped;
}

export interface LunchFlowPreviewAccount {
  providerAccountId: string;
  name: string;
  institution: string;
  currency: string;
  /** Signed from the holder's view: negative while a card or loan is owed. */
  balanceCents: number;
  suggestedType: AccountType;
  /** False when Lunch Flow says its link to the bank needs attention. */
  active: boolean;
  /** Already in Harbour through Lunch Flow (it stays connected). */
  existing: { id: string; name: string; type: AccountType } | null;
  /** The person chose not to import it last time. */
  skipped: boolean;
  /** False for an account in a currency Harbour can't add yet (it can only be left out). */
  supported: boolean;
}

export interface LinkableAccount {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  institution: string | null;
  transactionCount: number;
}

export interface LunchFlowPreview {
  accounts: LunchFlowPreviewAccount[];
  /** Manual accounts a Lunch Flow account can continue, keeping their history. */
  linkable: LinkableAccount[];
}

/** What the key can read, and how it relates to what's already in Harbour. Saves nothing. */
export async function previewLunchFlow(user: Person, apiKey: string): Promise<LunchFlowPreview> {
  assertCanConnect(user);
  const accounts = await discover(apiKey);
  const [connected, skipped, manual, currencies] = await Promise.all([
    connectedAccounts(
      user.id,
      accounts.map((a) => a.providerAccountId),
    ),
    previouslySkipped(user.id),
    prisma.account.findMany({
      where: { userId: user.id, isManual: true, status: { not: "CLOSED" } },
      select: { id: true, name: true, type: true, currency: true, institution: { select: { name: true } }, _count: { select: { transactions: true } } },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    }),
    currencyRule(user.id),
  ]);
  return {
    accounts: accounts.map((a) => {
      const existing = connected.get(a.providerAccountId);
      return {
        providerAccountId: a.providerAccountId,
        name: a.name,
        institution: a.institution,
        currency: a.currency,
        balanceCents: a.balanceCents,
        suggestedType: a.guessedType,
        active: a.active,
        existing: existing ? { id: existing.id, name: existing.name, type: existing.type } : null,
        skipped: !existing && skipped.has(a.providerAccountId),
        supported: Boolean(existing) || currencies.allows(a.currency),
      };
    }),
    linkable: manual.map((m) => ({ id: m.id, name: m.name, type: m.type, currency: m.currency, institution: m.institution?.name ?? null, transactionCount: m._count.transactions })),
  };
}

export interface LunchFlowConnectResult {
  /** "Neo Financial", or "Neo Financial and Tangerine". */
  institution: string;
  accounts: number;
  added: number;
  /** The connection was saved but its first import failed (safe message). */
  warning: string | null;
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "Lunch Flow") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Saves the key with the person's choices and runs the first import. Accounts already
 * connected through Lunch Flow stay connected (a new key simply replaces the old one).
 */
export async function connectLunchFlow(user: Person, apiKey: string, choices: LunchFlowChoice[]): Promise<LunchFlowConnectResult> {
  assertCanConnect(user);
  const accounts = await discover(apiKey);
  const byId = new Map(accounts.map((a) => [a.providerAccountId, a]));
  const choiceFor = new Map<string, LunchFlowChoice>();
  for (const c of choices) {
    if (!byId.has(c.providerAccountId)) throw new AppError("BAD_REQUEST", "Lunch Flow's accounts changed while you were choosing. Check the key again to see them as they are now.");
    if (choiceFor.has(c.providerAccountId)) throw new AppError("VALIDATION_FAILED", "Each account can only be chosen once.");
    choiceFor.set(c.providerAccountId, c);
  }
  const connected = await connectedAccounts(user.id, [...byId.keys()]);
  const currencies = await currencyRule(user.id);
  for (const c of choices) {
    const a = byId.get(c.providerAccountId)!;
    if (c.action !== "skip" && !connected.has(c.providerAccountId) && !currencies.allows(a.currency)) {
      throw new AppError("VALIDATION_FAILED", `${a.name} is in ${a.currency}, and Harbour only supports ${currencies.currency} accounts for now. Leave it out.`);
    }
  }

  // Manual accounts to continue: this person's, still open, each used once, same currency.
  const links = choices.filter((c): c is Extract<LunchFlowChoice, { action: "link" }> => c.action === "link" && !connected.has(c.providerAccountId));
  if (new Set(links.map((l) => l.linkAccountId)).size !== links.length) throw new AppError("VALIDATION_FAILED", "Each Harbour account can only continue one Lunch Flow account.");
  const targets = links.length
    ? await prisma.account.findMany({ where: { userId: user.id, id: { in: links.map((l) => l.linkAccountId) }, isManual: true, status: { not: "CLOSED" } }, select: { id: true, name: true, currency: true } })
    : [];
  for (const l of links) {
    const target = targets.find((t) => t.id === l.linkAccountId);
    if (!target) throw notFound("Account");
    const source = byId.get(l.providerAccountId)!;
    if (target.currency !== source.currency) {
      throw new AppError("VALIDATION_FAILED", `${target.name} is in ${target.currency}, but ${source.name} in Lunch Flow is in ${source.currency}. Bring it in as a new account instead.`);
    }
  }

  const imported = (a: LunchFlowAccount) => connected.has(a.providerAccountId) || (choiceFor.get(a.providerAccountId)?.action ?? "skip") !== "skip";
  if (!accounts.some(imported)) throw new AppError("VALIDATION_FAILED", "Choose at least one account to bring into Harbour.");

  const groups = new Map<string, LunchFlowAccount[]>();
  for (const a of accounts) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);

  let order = await prisma.account.count({ where: { userId: user.id } });
  const touched: string[] = [];
  const results: { institution: string; accounts: number; sync: SyncOutcome }[] = [];
  for (const [group, members] of groups) {
    const chosen = members.filter(imported);
    if (!chosen.length) continue;
    const institutionName = members[0]!.institution;
    // Scoped to the person: two people may connect the same bank through their own Lunch Flow accounts.
    const providerItemId = `${user.id}:${group}`;
    const token = encryptSecret(encodeLunchFlowToken({ key: apiKey, group, skip: members.filter((a) => !imported(a)).map((a) => a.providerAccountId) }));

    const connectionId = await prisma.$transaction(async (tx) => {
      const institution = await tx.institution.upsert({
        where: { provider_providerInstitutionId: { provider: "LUNCHFLOW", providerInstitutionId: slug(institutionName) || "lunch-flow" } },
        update: { name: institutionName },
        create: { provider: "LUNCHFLOW", providerInstitutionId: slug(institutionName) || "lunch-flow", name: institutionName, country: "CA" },
      });
      const previous = await tx.providerConnection.findUnique({ where: { provider_providerItemId: { provider: "LUNCHFLOW", providerItemId } }, select: { id: true } });
      const connection = previous
        ? await tx.providerConnection.update({ where: { id: previous.id }, data: { encryptedAccessToken: token, status: "ACTIVE", lastSyncError: null, institutionId: institution.id } })
        : await tx.providerConnection.create({ data: { userId: user.id, provider: "LUNCHFLOW", providerItemId, institutionId: institution.id, encryptedAccessToken: token } });

      let newAccounts = 0;
      for (const a of chosen) {
        const already = connected.get(a.providerAccountId);
        if (already) {
          if (already.connectionId !== connection.id) await tx.account.update({ where: { id: already.id }, data: { connectionId: connection.id, status: "ACTIVE" } });
          else await tx.account.update({ where: { id: already.id }, data: { status: "ACTIVE" } });
          continue;
        }
        const choice = choiceFor.get(a.providerAccountId);
        if (choice?.action === "link") {
          // Continues the manual account: its history stays and the sync skips what it already holds.
          await tx.account.update({
            where: { id: choice.linkAccountId },
            data: { connectionId: connection.id, providerAccountId: a.providerAccountId, institutionId: institution.id, isManual: false, type: choice.type, status: "ACTIVE" },
          });
          newAccounts++;
        } else if (choice?.action === "new") {
          await tx.account.create({
            data: {
              userId: user.id,
              connectionId: connection.id,
              institutionId: institution.id,
              providerAccountId: a.providerAccountId,
              name: a.name,
              officialName: a.name,
              type: choice.type,
              currency: a.currency,
              currentBalanceCents: isLiability(choice.type) ? -a.balanceCents || 0 : a.balanceCents,
              displayOrder: order++,
            },
          });
          newAccounts++;
        }
      }
      // Accounts added to a connection that synced before still get the first sync's full history.
      if (previous && newAccounts) await tx.providerConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: null } });
      return connection.id;
    });
    touched.push(connectionId);

    await audit(user.id, "account.connected", { type: "connection", id: connectionId }, { provider: "LUNCHFLOW", institution: institutionName, accounts: chosen.length });
    const sync = await syncConnection(user.id, connectionId, "connect");
    results.push({ institution: institutionName, accounts: chosen.length, sync });
  }

  // Lunch Flow connections whose accounts all moved to another one are left empty: remove them.
  await prisma.providerConnection.deleteMany({ where: { userId: user.id, provider: "LUNCHFLOW", id: { notIn: touched }, accounts: { none: {} } } });

  return {
    institution: joinNames([...new Set(results.map((r) => r.institution))]),
    accounts: results.reduce((n, r) => n + r.accounts, 0),
    added: results.reduce((n, r) => n + r.sync.added, 0),
    warning: results.find((r) => r.sync.status === "FAILED")?.sync.message ?? null,
  };
}
