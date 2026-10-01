import "server-only";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TIME_ZONE, formatDate, todayIn, type LocalDate } from "@/lib/dates";
import { formatCurrency, type Cents, type FormatCurrencyOptions } from "@/lib/finance/money";

/**
 * Formats money and dates in notification text the way the app shows them to this user
 * (their locale and currency), e.g. "$65.00 due Oct 3" rather than "due 2026-10-03".
 */
export async function notificationFormat(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true, currency: true, timeZone: true } });
  const locale = user?.locale ?? "en-CA";
  const currency = user?.currency ?? "CAD";
  const thisYear = todayIn(user?.timeZone ?? DEFAULT_TIME_ZONE).slice(0, 4);
  return {
    money: (cents: Cents, opts: FormatCurrencyOptions = {}) => formatCurrency(cents, { currency, locale, ...opts }),
    date: (date: LocalDate) => formatDate(date, date.startsWith(thisYear) ? "monthDay" : "medium", locale),
  };
}
