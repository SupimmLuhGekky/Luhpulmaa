import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { listAccounts } from "@/lib/accounts/service";
import { listImportBatches } from "@/lib/import/service";
import { isEnabled } from "@/lib/flags";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ImportHistory } from "@/components/import/import-history";
import { ImportWizard } from "@/components/import/import-wizard";

export const metadata: Metadata = { title: "Import transactions" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const user = await requireOnboardedUser();
  const [{ account }, accounts, batches] = await Promise.all([searchParams, listAccounts(user.id, { includeHidden: true }), listImportBatches(user.id)]);
  const importable = accounts.filter((a) => a.status !== "CLOSED");
  if (!isEnabled("ENABLE_CSV_IMPORT")) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader title="Import transactions" />
        <Card>
          <EmptyState title="CSV import is turned off" description="The person running this Harbour server has turned off CSV import (ENABLE_CSV_IMPORT)." />
        </Card>
      </div>
    );
  }
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
