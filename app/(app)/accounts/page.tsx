import Link from "next/link";
import type { Metadata } from "next";
import { FileUp, Plus } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { listAccounts, listConnections } from "@/lib/accounts/service";
import { isEnabled } from "@/lib/flags";
import { currentNetWorth } from "@/lib/networth/service";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { AccountsOverview } from "@/components/accounts/accounts-overview";
import { bankingInfo } from "@/components/accounts/banking-info";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ hidden?: string | string[] }> }) {
  const user = await requireOnboardedUser();
  const { hidden } = await searchParams;
  const [accounts, connections, netWorth] = await Promise.all([listAccounts(user.id, { includeHidden: true }), listConnections(user.id), currentNetWorth(user.id)]);
  const csvEnabled = isEnabled("ENABLE_CSV_IMPORT");

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Your bank accounts, cards, loans and investments in one place."
        actions={
          <>
            {csvEnabled ? (
              <Button variant="outline" asChild>
                <Link href="/transactions/import">
                  <FileUp aria-hidden /> Import CSV
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/accounts/new">
                <Plus aria-hidden /> Add account
              </Link>
            </Button>
          </>
        }
      />
      <AccountsOverview
        accounts={accounts}
        connections={connections}
        totals={{ assets: netWorth.assets, liabilities: netWorth.liabilities, netWorth: netWorth.netWorth }}
        banking={bankingInfo()}
        csvEnabled={csvEnabled}
        now={new Date().toISOString()}
        initialShowHidden={hidden === "1" || hidden === "true"}
      />
    </>
  );
}
