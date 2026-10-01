import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileUp } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { listAccounts } from "@/lib/accounts/service";
import { listCategories } from "@/lib/categories/service";
import { listTags, listTransactions } from "@/lib/transactions/service";
import { activeFilterCount, canonicalQuery, filtersFromSearchParams, txnFromSearchParams } from "@/lib/transactions/url";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { AddTransactionButton } from "@/components/transactions/add-transaction-button";
import { TransactionsView } from "@/components/transactions/transactions-view";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOnboardedUser();
  const sp = await searchParams;
  const canonical = canonicalQuery(sp);
  if (canonical !== null) redirect(canonical ? `/transactions?${canonical}` : "/transactions");
  const filters = filtersFromSearchParams(sp);
  const [list, accounts, categories, tags] = await Promise.all([listTransactions(user.id, filters), listAccounts(user.id, { includeHidden: true }), listCategories(user.id), listTags(user.id)]);
  const txn = txnFromSearchParams(sp);
  // A page past the end (e.g. after filtering) shows the last page instead of nothing.
  const page = Math.min(list.page, list.pageCount);
  const data = page !== list.page ? await listTransactions(user.id, { ...filters, page }) : list;

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Everything from your accounts and imports, newest first."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/transactions/import">
                <FileUp /> Import CSV
              </Link>
            </Button>
            <AddTransactionButton />
          </>
        }
      />
      <TransactionsView
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageCount={data.pageCount}
        pageSize={data.pageSize}
        totals={data.totals}
        filters={filters}
        activeCount={activeFilterCount(filters)}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, mask: a.mask }))}
        categories={categories.filter((c) => !c.isHidden).map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, kind: c.kind, subcategories: c.subcategories.map((s) => ({ id: s.id, name: s.name })) }))}
        tags={tags.map((t) => ({ id: t.id, name: t.name }))}
        openId={txn}
      />
    </>
  );
}
