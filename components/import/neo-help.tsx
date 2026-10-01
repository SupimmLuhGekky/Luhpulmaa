import { ChevronDown, ShieldCheck } from "lucide-react";

/** How to get a CSV out of Neo Financial (and other banks). Kept factual: menu names can change. */
export function NeoHelp() {
  return (
    <details className="group rounded-xl border border-border bg-subtle px-4 py-3 text-[13px]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">
        How do I get a CSV file from Neo Financial?
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-3 space-y-3 text-muted-foreground">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Sign in to Neo Financial in a web browser. Exports are only available on the website, not in the mobile app.</li>
          <li>Open the account or card you want, then its transactions or statements.</li>
          <li>Choose the option to export or download, pick a date range and the CSV format.</li>
          <li>Come back here and choose the downloaded file.</li>
        </ol>
        <p>Neo limits each export to about 2,000 transactions, so for a long history export a few months at a time. Importing overlapping files is safe: transactions that are already here are skipped.</p>
        <p>Other Canadian banks (Desjardins, RBC, TD, BMO, Scotiabank, National Bank, Tangerine, EQ Bank…) offer a similar CSV download in online banking. Harbour reads English and French files.</p>
        <p className="flex items-start gap-2 text-foreground/80">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
          Harbour only receives the file you choose. Never share your bank password, card number or one-time codes with any app, including this one.
        </p>
      </div>
    </details>
  );
}
