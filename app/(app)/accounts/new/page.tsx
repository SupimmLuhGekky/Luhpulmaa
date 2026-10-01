import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { listConnections, mockInstitutions } from "@/lib/accounts/service";
import { isEnabled } from "@/lib/flags";
import { PageHeader } from "@/components/shared/page-header";
import { AddAccount } from "@/components/accounts/add-account";
import { bankingInfo } from "@/components/accounts/banking-info";
import type { SimulatedInstitution } from "@/components/accounts/connect-bank";
import { ADD_METHODS, type AddMethod } from "@/components/accounts/types";

export const metadata: Metadata = { title: "Add an account" };

function parseMethod(value: string | string[] | undefined): AddMethod | null {
  const v = Array.isArray(value) ? value[0] : value;
  return ADD_METHODS.includes(v as AddMethod) ? (v as AddMethod) : null;
}

export default async function NewAccountPage({ searchParams }: { searchParams: Promise<{ method?: string | string[] }> }) {
  const user = await requireOnboardedUser();
  const { method } = await searchParams;
  const banking = bankingInfo();

  let institutions: SimulatedInstitution[] = [];
  if (banking.enabled && banking.simulated) {
    const connections = await listConnections(user.id);
    institutions = mockInstitutions().map((i) => {
      const c = connections.find((x) => x.provider === "MOCK" && x.institution === i.name);
      return { ...i, connection: c ? { id: c.id, status: c.status, accountCount: c.accountCount } : null };
    });
  }

  return (
    <div className="max-w-5xl">
      <Link href="/accounts" className="mb-3 inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Accounts
      </Link>
      <PageHeader title="Add an account" description="Bring in a bank account, card, loan or investment. Choose whichever way suits that account." />
      <AddAccount
        initialMethod={parseMethod(method)}
        banking={banking}
        institutions={institutions}
        csvEnabled={isEnabled("ENABLE_CSV_IMPORT")}
        multiCurrency={isEnabled("ENABLE_MULTI_CURRENCY")}
        currency={user.currency}
      />
    </div>
  );
}
