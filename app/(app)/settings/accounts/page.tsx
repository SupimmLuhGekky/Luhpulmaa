import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileUp, Plus } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { isEnabled } from "@/lib/flags";
import { bankingStatus } from "@/lib/banking/registry";
import { listAccounts, listConnections } from "@/lib/accounts/service";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { ConnectionsList, type ConnectionRow } from "@/components/settings/connections-list";
import { SettingsPageHeader, SettingRow, SettingRows, SettingsSection } from "@/components/settings/settings-ui";

export const metadata: Metadata = { title: "Accounts & services · Settings" };

export default async function AccountsSettingsPage() {
  const user = await requireOnboardedUser();
  const [connections, accounts] = await Promise.all([listConnections(user.id), listAccounts(user.id, { includeHidden: true })]);
  const banking = bankingStatus();
  const csvImport = isEnabled("ENABLE_CSV_IMPORT");
  const manual = accounts.filter((a) => a.isManual);
  const hidden = accounts.filter((a) => a.isHidden).length;
  const rows: ConnectionRow[] = connections.map((c) => ({ ...c, status: c.status as ConnectionRow["status"] }));

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Accounts & connected services"
        description="Harbour reads balances and transactions through a secure data provider. It never sees or stores your bank password."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/accounts">
              Manage accounts <ArrowRight />
            </Link>
          </Button>
        }
      />
      <SettingsSection
        id="connections"
        title="Bank connections"
        description={banking.enabled ? `Connections go through ${banking.displayName}.` : "Bank connections are turned off on this server."}
        action={
          banking.enabled ? (
            <Button asChild size="sm">
              <Link href="/accounts/new?method=connect">
                <Plus /> Connect a bank
              </Link>
            </Button>
          ) : null
        }
      >
        <div className="space-y-4">
          {banking.enabled && banking.simulated ? (
            <Notice tone="info" title="Simulated bank data">
              This server uses a simulated demo bank. Its accounts and transactions are generated for testing and aren&apos;t real money.
            </Notice>
          ) : null}
          {banking.enabled && !banking.configured ? (
            <Notice tone="warning" title="Bank connections aren't set up yet">
              You can still add accounts manually{csvImport ? " or import CSV files from your bank" : ""}.
            </Notice>
          ) : null}
          <ConnectionsList connections={rows} />
        </div>
      </SettingsSection>
      <SettingsSection id="other-sources" title="Other ways to add data" description="For banks without a connection, cash, or anything you'd rather track by hand.">
        <SettingRows>
          <SettingRow label="Manual accounts" description={manual.length ? `${manual.length} manual ${manual.length === 1 ? "account" : "accounts"}. You update their balances yourself.` : "Track cash, a loan or any account without connecting it."}>
            <Button asChild variant="outline" size="sm">
              <Link href="/accounts/new?method=manual">
                <Plus /> Add manually
              </Link>
            </Button>
          </SettingRow>
          {csvImport ? (
            <SettingRow label="CSV import" description="Upload a statement export from your bank's website. Duplicates are skipped.">
              <Button asChild variant="outline" size="sm">
                <Link href="/transactions/import">
                  <FileUp /> Import a file
                </Link>
              </Button>
            </SettingRow>
          ) : null}
          {hidden ? (
            <SettingRow label="Hidden accounts" description={`${hidden} hidden ${hidden === 1 ? "account is" : "accounts are"} left out of lists and totals.`}>
              <Button asChild variant="ghost" size="sm">
                <Link href="/accounts">Review</Link>
              </Button>
            </SettingRow>
          ) : null}
        </SettingRows>
      </SettingsSection>
    </div>
  );
}
