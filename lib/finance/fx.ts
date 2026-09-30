import "server-only";
import { prisma } from "@/lib/db/prisma";
import { isEnabled } from "@/lib/flags";
import type { Cents } from "./money";

/**
 * Currency conversion for totals. With ENABLE_MULTI_CURRENCY off, amounts are summed
 * as-is (single-currency mode). With it on, user-maintained rates (Settings → Currency)
 * are applied using exact decimal arithmetic (rate × 10^8 as BigInt).
 * Missing rates fall back to 1:1 and the UI flags the account as unconverted.
 */
export async function convertToBase(userId: string, amount: Cents, from: string, base: string): Promise<Cents> {
  if (from === base || !isEnabled("ENABLE_MULTI_CURRENCY")) return amount;
  const rate = await prisma.exchangeRate.findUnique({ where: { userId_base_quote: { userId, base: from, quote: base } } });
  if (!rate) return amount;
  const scaled = BigInt(rate.rate.mul(100_000_000).toFixed(0));
  const product = BigInt(amount) * scaled;
  const q = product / 100_000_000n;
  const r = product % 100_000_000n;
  const abs = r < 0n ? -r : r;
  const rounded = abs * 2n >= 100_000_000n ? (product < 0n ? q - 1n : q + 1n) : q;
  return Number(rounded);
}
