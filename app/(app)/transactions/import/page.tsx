import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { listAccounts } from "@/lib/accounts/service";
import { listImportBatches } from "@/lib/import/service";
import { PageHeader } from "@/components/shared/page-header";
import { ImportHistory } from "@/components/import/import-history";
import { ImportWizard } from "@/components/import/import-wizard";

export const metadata: Metadata = { title: "Import transactions" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const user = await requireOnboardedUser();
  const [{ account }, accounts, batches] = await Promise.all([searchParams, listAccounts(user.id, { includeHidden: true }), listImportBatches(user.id)]);
  const importable = accounts.filter((a) => a.status !== "CLOSED");
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Import transactions" description="Bring in a CSV file from Neo Financial or any other bank." className="pb-1" />
      <ImportWizard
        accounts={importable.map((a) => ({ id: a.id, name: a.name, type: a.type, mask: a.mask, institution: a.institution?.name ?? null }))}
        defaultAccountId={importable.some((a) => a.id === account) ? account : undefined}
      />
      <ImportHistory batches={batches} />
    </div>
  );
}
