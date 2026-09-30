import { randomBytes } from "node:crypto";
import { addDays, todayIn, type LocalDate } from "@/lib/dates";
import { ProviderError, type ExchangeResult, type FinancialDataProvider, type LinkSession, type ProviderAccount, type TransactionPage, type TransactionQuery } from "../types";
import { generateMockTransactions, hashString, MOCK_INSTITUTIONS, mockAccountSpecs, mockOpeningDate, type MockTxn } from "./mock-data";

/**
 * MOCK provider — a fully simulated institution for development, demos and tests.
 * No network calls, no credentials. Data is deterministic per connection, so running
 * a sync twice returns identical ids (exercising idempotency) and recent transactions
 * move from pending to posted over time (exercising pending replacement).
 *
 * Access token format (not secret, but still encrypted at rest like any other):
 *   "mock:<seed>:<historyStart>:<institutionId>"
 */
const PENDING_DAYS = 2;

interface MockToken {
  seed: number;
  anchor: LocalDate;
  institutionId: string;
}

function parseToken(token: string): MockToken {
  const [prefix, seed, anchor, institutionId] = token.split(":");
  if (prefix !== "mock" || !seed || !anchor || !institutionId) throw new ProviderError("INVALID_REQUEST", "Unrecognised demo connection.");
  return { seed: Number(seed), anchor, institutionId };
}

export class MockProvider implements FinancialDataProvider {
  readonly id = "MOCK" as const;
  readonly displayName = "Demo bank (simulated data)";
  readonly isSimulated = true;

  constructor(private readonly clock: () => LocalDate = () => process.env.MOCK_TODAY || todayIn("America/Toronto")) {}

  isConfigured() {
    return true;
  }

  async createLinkSession(): Promise<LinkSession> {
    return {
      provider: "MOCK",
      mode: "mock",
      linkToken: `mock-link-${randomBytes(8).toString("hex")}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
  }

  async exchangePublicToken(userId: string, publicToken: string): Promise<ExchangeResult> {
    const [prefix, institutionId] = publicToken.split(":");
    const institution = MOCK_INSTITUTIONS.find((i) => i.id === institutionId);
    if (prefix !== "mock-public" || !institution) throw new ProviderError("INVALID_REQUEST", "The demo connection could not be completed.");
    if (institution.id === "mock_error") {
      throw new ProviderError("INSTITUTION_UNAVAILABLE", "This institution is not responding right now. Please try again later.", true);
    }
    // One seed per user+institution keeps reconnecting the same demo bank stable.
    const seed = hashString(`${userId}:${institution.id}`);
    const anchor = mockOpeningDate(this.clock());
    return {
      providerItemId: `mock-item-${seed.toString(36)}`,
      accessToken: `mock:${seed}:${anchor}:${institution.id}`,
      institution: { providerInstitutionId: institution.id, name: institution.name, country: "CA", primaryColor: institution.color },
    };
  }

  private allTransactions(t: MockToken, until: LocalDate): MockTxn[] {
    return generateMockTransactions(t.seed, t.anchor, t.anchor, until);
  }

  async getAccounts(accessToken: string): Promise<ProviderAccount[]> {
    const t = parseToken(accessToken);
    const today = this.clock();
    const txns = this.allTransactions(t, today);
    const pendingFrom = addDays(today, -(PENDING_DAYS - 1));
    return mockAccountSpecs(t.seed).map((spec) => {
      const mine = txns.filter((x) => x.accountKey === spec.key);
      const posted = mine.filter((x) => x.date < pendingFrom).reduce((a, x) => a + x.amountCents, 0);
      const pending = mine.filter((x) => x.date >= pendingFrom).reduce((a, x) => a + x.amountCents, 0);
      const isLiability = spec.type === "CREDIT_CARD";
      const current = isLiability ? spec.openingBalanceCents - posted : spec.openingBalanceCents + posted;
      const available = isLiability ? (spec.creditLimitCents ?? 0) - (current - pending) : current + pending;
      return {
        providerAccountId: `${spec.key}-${t.seed.toString(36)}`,
        name: spec.name,
        officialName: spec.name,
        mask: spec.mask,
        type: spec.type,
        currency: "CAD",
        currentBalanceCents: current,
        availableBalanceCents: available,
        creditLimitCents: spec.creditLimitCents ?? null,
      };
    });
  }

  async getBalances(accessToken: string) {
    return this.getAccounts(accessToken);
  }

  /**
   * Range-based: returns every transaction in [startDate, endDate] (clamped to today).
   * Transactions from the last PENDING_DAYS are pending with a "pd_" id; once older
   * they are returned posted, with `pendingTransactionId` pointing at the pending id.
   */
  async getTransactions(accessToken: string, query: TransactionQuery): Promise<TransactionPage> {
    const t = parseToken(accessToken);
    const today = this.clock();
    const end = query.endDate > today ? today : query.endDate;
    const pendingFrom = addDays(today, -(PENDING_DAYS - 1));
    const accounts = new Map(mockAccountSpecs(t.seed).map((s) => [s.key, `${s.key}-${t.seed.toString(36)}`]));
    const txns = generateMockTransactions(t.seed, t.anchor, query.startDate, end);
    return {
      added: txns.map((x) => {
        const pending = x.date >= pendingFrom;
        return {
          providerTransactionId: pending ? `pd_${x.id}` : x.id,
          providerAccountId: accounts.get(x.accountKey)!,
          pendingTransactionId: pending ? null : `pd_${x.id}`,
          date: x.date,
          postedDate: pending ? null : addDays(x.date, 1) > today ? x.date : addDays(x.date, 1),
          amountCents: x.amountCents,
          currency: "CAD",
          description: x.description,
          merchantName: x.merchantName,
          pending,
          categoryHint: null,
        };
      }),
      modified: [],
      removed: [],
      nextCursor: end,
      hasMore: false,
    };
  }

  async disconnectAccount(accessToken: string) {
    parseToken(accessToken);
  }
}
