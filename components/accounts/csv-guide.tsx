import Link from "next/link";
import { FileUp, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";

const NEO_STEPS: React.ReactNode[] = [
  <>
    On a computer, sign in to the Neo web app by typing <span className="font-medium text-foreground">neo.cafe</span> into your browser.
  </>,
  <>Open the account or card you want to bring into Harbour.</>,
  <>
    Go to its statements or transactions and choose <span className="font-medium text-foreground">Export</span>, in CSV format.
  </>,
  <>Pick the dates to include. Neo exports at most about 2,000 rows per file, so split a long history into a few date ranges.</>,
  <>Save the file, then import it here.</>,
];

/** How to get a CSV out of Neo Financial (and other banks), then on to the importer. */
export function CsvGuide({ enabled, onAddManually }: { enabled: boolean; onAddManually: () => void }) {
  return (
    <div className="space-y-5">
      {!enabled ? (
        <Notice tone="warning" title="CSV import is turned off on this server">
          You can still add accounts by hand and update their balances yourself.
        </Notice>
      ) : null}

      <section aria-labelledby="csv-neo">
        <h3 id="csv-neo" className="text-sm font-semibold">
          Export from Neo Financial
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">Neo doesn&apos;t connect through Plaid, so a CSV export from Neo&apos;s web app is the reliable way to bring in your Neo accounts.</p>
        <ol className="mt-3 space-y-2.5">
          {NEO_STEPS.map((step, i) => (
            <li key={i} className="flex gap-3 text-[13px] text-muted-foreground">
              <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary" aria-hidden>
                {i + 1}
              </span>
              <span className="min-w-0 pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Neo may name these menus a little differently. Harbour never asks for your Neo password: you download the file yourself and choose what to import.
        </p>
      </section>

      <section aria-labelledby="csv-other" className="border-t border-border pt-4">
        <h3 id="csv-other" className="text-sm font-semibold">
          Other banks
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Most banks let you download your transactions from online banking, usually from the account&apos;s activity or statements page. Look for Download or Export, and choose CSV if you&apos;re offered a format.
        </p>
      </section>

      <section aria-labelledby="csv-next" className="border-t border-border pt-4">
        <h3 id="csv-next" className="text-sm font-semibold">
          Import the file
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">The importer asks which account the transactions belong to. If the account isn&apos;t in Harbour yet, add it by hand first: it only takes a moment.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          {enabled ? (
            <Button asChild>
              <Link href="/transactions/import">
                <FileUp aria-hidden /> Import a CSV file
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" onClick={onAddManually}>
            <PencilLine aria-hidden /> Add the account by hand
          </Button>
        </div>
      </section>
    </div>
  );
}
