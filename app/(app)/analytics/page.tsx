import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { listAccounts } from "@/lib/accounts/service";
import { ACCOUNT_TYPE_LABELS } from "@/lib/accounts/types";
import { analyticsQueryFromParams } from "@/lib/analytics/range";
import { analytics } from "@/lib/analytics/service";
import { listCategories } from "@/lib/categories/service";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata: Metadata = { title: "Analytics" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const user = await requireOnboardedUser();
  const [accounts, categories] = await Promise.all([listAccounts(user.id, { includeHidden: true }), listCategories(user.id)]);
  const categoryOptions = categories.filter((c) => c.kind !== "TRANSFER" && !c.isHidden);

  // Only the user's own accounts and categories can narrow the figures; stale ids are dropped.
  const q = analyticsQueryFromParams(params);
  const own = (ids: string[] | undefined, allowed: Set<string>) => {
    const kept = (ids ?? []).filter((id) => allowed.has(id));
    return kept.length ? kept : undefined;
  };
  const query = {
    ...q,
    accounts: own(q.accounts, new Set(accounts.map((a) => a.id))),
    categories: own(q.categories, new Set(categoryOptions.map((c) => c.id))),
  };
  const data = await analytics(user.id, query);

  return (
    <AnalyticsView
      data={data}
      applied={{ range: query.range, from: data.range.from, to: data.range.to, accounts: query.accounts ?? [], categories: query.categories ?? [] }}
      accountGroups={[
        {
          options: accounts.map((a) => ({
            id: a.id,
            name: a.name,
            detail: [a.institution?.name ?? ACCOUNT_TYPE_LABELS[a.type], a.mask ? `••${a.mask}` : null, a.isHidden ? "hidden" : null].filter(Boolean).join(" · "),
          })),
        },
      ]}
      categoryGroups={[
        { label: "Spending", options: categoryOptions.filter((c) => c.kind === "EXPENSE").map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color })) },
        { label: "Income", options: categoryOptions.filter((c) => c.kind === "INCOME").map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color })) },
      ]}
    />
  );
}
