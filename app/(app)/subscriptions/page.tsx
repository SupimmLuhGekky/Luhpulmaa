import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { listAccounts } from "@/lib/accounts/service";
import { listBills } from "@/lib/bills/service";
import { listCategories } from "@/lib/categories/service";
import { todayIn } from "@/lib/dates";
import { listRecurring } from "@/lib/recurring/service";
import { listSubscriptions } from "@/lib/subscriptions/service";
import { upcomingCharges } from "@/lib/subscriptions/upcoming";
import { SubscriptionsView } from "@/components/subscriptions/subscriptions-view";

export const metadata: Metadata = { title: "Subscriptions" };

const UPCOMING_DAYS = 30;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SubscriptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireOnboardedUser();
  const today = todayIn(user.timeZone);
  const params = await searchParams;
  const [{ rows, totals }, recurring, bills, categories, accounts] = await Promise.all([
    listSubscriptions(user.id, today),
    listRecurring(user.id),
    listBills(user.id),
    listCategories(user.id),
    listAccounts(user.id),
  ]);

  const billSeries = [...new Set(bills.map((b) => b.recurringId).filter((id): id is string => Boolean(id)))];
  const linked = new Set(rows.map((r) => r.recurringId).filter(Boolean));
  const candidates = recurring
    .filter((r) => r.direction === "OUTFLOW" && !r.isSubscription && !linked.has(r.id))
    .map((r) => ({ ...r, isBill: billSeries.includes(r.id) }))
    // Likely subscriptions (not already bills) first.
    .sort((a, b) => Number(a.isBill) - Number(b.isBill) || a.name.localeCompare(b.name));

  return (
    <SubscriptionsView
      rows={rows}
      totals={totals}
      upcoming={upcomingCharges(rows, today, UPCOMING_DAYS)}
      upcomingDays={UPCOMING_DAYS}
      candidates={candidates}
      billSeries={billSeries}
      options={{
        categories: categories.filter((c) => c.kind === "EXPENSE" && !c.isHidden).map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color })),
        accounts: accounts.map((a) => ({ id: a.id, name: a.name, mask: a.mask })),
      }}
      openNew={params.new === "1"}
    />
  );
}
