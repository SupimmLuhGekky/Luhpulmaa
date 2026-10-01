import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { listAccounts } from "@/lib/accounts/service";
import { parseCalendarParams, viewRange } from "@/lib/bills/calendar";
import { billOccurrences, billsBeforePayday, listBills } from "@/lib/bills/service";
import { listCategories } from "@/lib/categories/service";
import { todayIn } from "@/lib/dates";
import { monthlyEquivalent, yearlyEquivalent } from "@/lib/finance/frequency";
import { getProfile } from "@/lib/users/service";
import { userPreferences } from "@/lib/settings/preferences";
import { BillsView } from "@/components/bills/bills-view";

export const metadata: Metadata = { title: "Bills" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BillsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireOnboardedUser();
  const today = todayIn(user.timeZone);
  const params = await searchParams;
  const { view, date } = parseCalendarParams(params, today);
  const profile = await getProfile(user.id);
  const range = viewRange(view, date, profile.weekStartsOn);

  const [occurrences, beforePayday, bills, categories, accounts, prefs] = await Promise.all([
    billOccurrences(user.id, range.from, range.to),
    billsBeforePayday(user.id, today),
    listBills(user.id, today),
    listCategories(user.id),
    listAccounts(user.id),
    userPreferences(user.id),
  ]);

  const repeating = bills.filter((b) => b.isActive && b.frequency !== "ONE_TIME");
  const recurring = {
    monthly: repeating.reduce((sum, b) => sum + monthlyEquivalent(b.amountCents, b.frequency), 0),
    yearly: repeating.reduce((sum, b) => sum + yearlyEquivalent(b.amountCents, b.frequency), 0),
    count: repeating.length,
  };

  return (
    <BillsView
      view={view}
      date={date}
      weekStartsOn={profile.weekStartsOn}
      occurrences={occurrences}
      beforePayday={beforePayday}
      bills={bills}
      recurring={recurring}
      options={{
        categories: categories.filter((c) => c.kind === "EXPENSE" && !c.isHidden).map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color })),
        accounts: accounts.map((a) => ({ id: a.id, name: a.name, mask: a.mask })),
        defaultReminderDays: prefs.billReminderDays,
      }}
      openNew={params.new === "1"}
    />
  );
}
