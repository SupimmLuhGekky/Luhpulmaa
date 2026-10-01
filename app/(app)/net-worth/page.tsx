import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { parseNetWorthRange } from "@/lib/networth/contributions";
import { netWorthOverview } from "@/lib/networth/service";
import { NetWorthView } from "@/components/networth/net-worth-view";

export const metadata: Metadata = { title: "Net worth" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NetWorthPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const user = await requireOnboardedUser();
  const range = parseNetWorthRange(Array.isArray(params.range) ? params.range[0] : params.range);
  const data = await netWorthOverview(user.id, range);
  return <NetWorthView data={data} />;
}
