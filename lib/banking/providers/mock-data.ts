/**
 * Deterministic simulated banking data for the MOCK provider.
 *
 * Everything is derived from a seed and a calendar date with a seeded PRNG, so the
 * same connection always returns the same transactions with the same ids — which is
 * exactly what makes sync idempotency testable. Institutions are fictional and every
 * account is labelled as simulated in the UI.
 */
import type { AccountType } from "@prisma/client";
import { addDays, addMonths, daysBetween, type LocalDate } from "@/lib/dates";

export const MOCK_INSTITUTIONS = [
  { id: "mock_maple", name: "Maple Trust (Demo)", color: "#dc2626" },
  { id: "mock_laurentian", name: "Laurentide Credit Union (Demo)", color: "#16a34a" },
  { id: "mock_northern", name: "Northern Lights Bank (Demo)", color: "#2563eb" },
  { id: "mock_error", name: "Unstable Test Bank (Demo — always fails)", color: "#71717a" },
] as const;

export type MockInstitutionId = (typeof MOCK_INSTITUTIONS)[number]["id"];

/** mulberry32 */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function between(rand: () => number, minCents: number, maxCents: number): number {
  return minCents + Math.floor(rand() * (maxCents - minCents + 1));
}

export interface MockAccountSpec {
  key: "chequing" | "savings" | "credit";
  name: string;
  type: AccountType;
  mask: string;
  openingBalanceCents: number;
  creditLimitCents?: number;
}

export function mockAccountSpecs(seed: number): MockAccountSpec[] {
  const rand = prng(seed);
  const m = () => String(1000 + Math.floor(rand() * 9000));
  return [
    { key: "chequing", name: "Everyday Chequing", type: "CHEQUING", mask: m(), openingBalanceCents: 210_000 + Math.floor(rand() * 60_000) },
    { key: "savings", name: "High Interest Savings", type: "SAVINGS", mask: m(), openingBalanceCents: 520_000 + Math.floor(rand() * 100_000) },
    { key: "credit", name: "Cashback Visa", type: "CREDIT_CARD", mask: m(), openingBalanceCents: 42_000, creditLimitCents: 500_000 },
  ];
}

export interface MockTxn {
  id: string;
  accountKey: MockAccountSpec["key"];
  date: LocalDate;
  amountCents: number;
  description: string;
  merchantName: string | null;
}

interface Discretionary {
  merchant: string;
  description: string;
  min: number;
  max: number;
  weight: number;
  account: "chequing" | "credit";
}

const DISCRETIONARY: Discretionary[] = [
  { merchant: "Metro", description: "METRO #212 MONTREAL QC", min: 2_500, max: 14_000, weight: 9, account: "credit" },
  { merchant: "IGA", description: "IGA EXTRA #8123", min: 1_800, max: 9_500, weight: 5, account: "credit" },
  { merchant: "Maxi", description: "MAXI #8871 LAVAL", min: 3_000, max: 12_000, weight: 4, account: "chequing" },
  { merchant: "Tim Hortons", description: "TIM HORTONS #4412", min: 250, max: 1_200, weight: 10, account: "credit" },
  { merchant: "Starbucks", description: "STARBUCKS 04421", min: 450, max: 1_100, weight: 4, account: "credit" },
  { merchant: "McDonald's", description: "MCDONALD'S #40213", min: 900, max: 2_200, weight: 4, account: "credit" },
  { merchant: "Uber Eats", description: "UBER* EATS PENDING", min: 1_800, max: 4_800, weight: 5, account: "credit" },
  { merchant: "Uber", description: "UBER* TRIP HELP.UBER.COM", min: 1_100, max: 3_800, weight: 4, account: "credit" },
  { merchant: "Petro-Canada", description: "PETRO-CANADA 98231", min: 4_000, max: 8_500, weight: 3, account: "credit" },
  { merchant: "Amazon", description: "AMZN MKTP CA*2K81L", min: 1_500, max: 11_000, weight: 4, account: "credit" },
  { merchant: "Canadian Tire", description: "CANADIAN TIRE #0452", min: 1_200, max: 9_000, weight: 2, account: "credit" },
  { merchant: "Cineplex", description: "CINEPLEX ENTERTAINMENT", min: 1_500, max: 4_500, weight: 2, account: "credit" },
  { merchant: "SAQ", description: "SAQ SELECTION 23110", min: 1_800, max: 6_000, weight: 2, account: "credit" },
  { merchant: "Jean Coutu", description: "JEAN COUTU #121", min: 800, max: 5_500, weight: 2, account: "chequing" },
  { merchant: "Dollarama", description: "DOLLARAMA #1043", min: 300, max: 2_500, weight: 2, account: "chequing" },
  { merchant: "Simons", description: "SIMONS MONTREAL", min: 3_000, max: 12_000, weight: 1, account: "credit" },
  { merchant: "Restaurant Chez Lola", description: "RESTAURANT CHEZ LOLA", min: 2_800, max: 9_000, weight: 3, account: "credit" },
  { merchant: "Pizzeria Napoletana", description: "PIZZERIA NAPOLETANA", min: 2_200, max: 5_500, weight: 2, account: "credit" },
];

const DISCRETIONARY_TOTAL_WEIGHT = DISCRETIONARY.reduce((a, d) => a + d.weight, 0);

function pickDiscretionary(rand: () => number): Discretionary {
  let r = rand() * DISCRETIONARY_TOTAL_WEIGHT;
  for (const d of DISCRETIONARY) {
    r -= d.weight;
    if (r <= 0) return d;
  }
  return DISCRETIONARY[0];
}

/** A Friday. Paydays fall every 14 days from here (or a week later, depending on the seed). */
const PAY_CYCLE_EPOCH: LocalDate = "2020-01-03";

/** Everything that happens on one calendar day except the credit-card payment. */
function dayTransactions(seed: number, d: LocalDate): MockTxn[] {
  const out: MockTxn[] = [];
  const day = Number(d.slice(8, 10));
  const monthRand = prng(hashString(`${seed}:${d.slice(0, 7)}`));
  const add = (accountKey: MockTxn["accountKey"], n: number, amountCents: number, description: string, merchantName: string | null) =>
    out.push({ id: `mk_${seed.toString(36)}_${d.replace(/-/g, "")}_${accountKey[0]}${n}`, accountKey, date: d, amountCents, description, merchantName });

  const payAmount = 184_500 + (seed % 7) * 500;
  // Biweekly Friday paycheque on a cadence fixed per seed, not per connection date, so
  // linking the same demo bank again later replays the same history instead of shifting it.
  const firstPayday = addDays(PAY_CYCLE_EPOCH, (seed % 2) * 7);
  const sincePay = daysBetween(firstPayday, d);
  if (sincePay >= 0 && sincePay % 14 === 0) {
    const bonus = prng(hashString(`${seed}:pay:${d}`))() < 0.1 ? 15_000 : 0;
    add("chequing", 1, payAmount + bonus, "HARBOURFRONT GRILL PAYROLL DEP", "Harbourfront Grill");
    // Automatic transfer to savings on payday
    add("chequing", 2, -25_000, "ONLINE TRANSFER TO SAVINGS", null);
  }
  if (sincePay >= 0 && sincePay % 14 === 0) add("savings", 1, 25_000, "ONLINE TRANSFER FROM CHEQUING", null);
  if (day === 1) add("chequing", 3, -125_000, "INTERAC E-TRANSFER RENT - LANDLORD", "Rent");
  if (day === 1) add("chequing", 4, -9_700, "STM OPUS MONTHLY PASS", "STM");
  if (day === 3) add("chequing", 5, -6_500, "FIZZ MOBILE PREAUTHORIZED", "Fizz");
  if (day === 8) add("credit", 1, -2_299, "NETFLIX.COM", "Netflix");
  if (day === 12) add("chequing", 6, -7_500, "VIDEOTRON LTEE INTERNET", "Vidéotron");
  if (day === 16) add("credit", 2, -1_199, "SPOTIFY P1C3B2", "Spotify");
  if (day === 18) add("chequing", 7, -between(monthRand, 6_800, 11_500), "HYDRO-QUEBEC PAIEMENT", "Hydro-Québec");
  if (day === 20) add("chequing", 8, -8_950, "DESJARDINS ASSURANCES PAD", "Desjardins Assurances");
  if (day === 22) add("credit", 3, -3_499, "ENERGIE CARDIO MEMBERSHIP", "Énergie Cardio");
  if (day === 28) add("savings", 2, between(monthRand, 850, 1_250), "INTEREST PAID", null);
  if (day === 5 && Number(d.slice(5, 7)) % 3 === 0) add("chequing", 10, -1_495, "MONTHLY ACCOUNT FEE", null);

  // Day-to-day spending: 0–3 purchases a day
  const rand = prng(hashString(`${seed}:day:${d}`));
  const count = Math.floor(rand() * 3.2);
  for (let i = 0; i < count; i++) {
    const pick = pickDiscretionary(rand);
    add(pick.account, 20 + i, -between(rand, pick.min, pick.max), pick.description, pick.merchant);
  }
  // Occasional refund
  if (rand() < 0.02) add("credit", 30, between(rand, 1_500, 6_000), "AMZN MKTP CA REFUND", "Amazon");
  return out;
}

/**
 * Generates all simulated transactions for a connection between `start` and `end`.
 * `anchor` is the connection's history start: nothing is generated before it.
 * Every value is a pure function of (seed, anchor, date), so any window returns the
 * same ids and amounts — which is what makes sync idempotency testable.
 */
export function generateMockTransactions(seed: number, anchor: LocalDate, start: LocalDate, end: LocalDate): MockTxn[] {
  const out: MockTxn[] = [];
  const from = start < anchor ? anchor : start;
  if (end < from) return out;
  for (let d = from; d <= end; d = addDays(d, 1)) {
    out.push(...dayTransactions(seed, d));
    if (Number(d.slice(8, 10)) === 26) {
      // Pay the card's statement in full: everything charged since the previous payment day.
      const cycleStart = addMonths(d, -1) < anchor ? anchor : addMonths(d, -1);
      let statement = 0;
      for (let c = cycleStart; c < d; c = addDays(c, 1)) {
        for (const t of dayTransactions(seed, c)) if (t.accountKey === "credit") statement -= t.amountCents;
      }
      if (statement > 0) {
        const id = (k: string, n: number) => `mk_${seed.toString(36)}_${d.replace(/-/g, "")}_${k}${n}`;
        out.push({ id: id("c", 9), accountKey: "chequing", date: d, amountCents: -statement, description: "VISA PAYMENT - CASHBACK VISA", merchantName: null });
        out.push({ id: id("c", 4), accountKey: "credit", date: d, amountCents: statement, description: "PAYMENT THANK YOU / PAIEMENT MERCI", merchantName: null });
      }
    }
  }
  return out;
}

export function mockOpeningDate(connectedOn: LocalDate): LocalDate {
  return addMonths(connectedOn, -6);
}
