"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, FileUp, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeading } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, FormError } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { useFormat } from "@/components/providers/format-provider";
import { cn } from "@/lib/utils";
import { DATE_FORMATS, MAX_IMPORT_ROWS, detectDateFormat, guessMapping, looksLikeHeader, normalizeImportRows, suggestInvertAmounts, type DateFormat, type ImportMapping } from "@/lib/import/normalize";
import { commitImportAction, createImportAccountAction, previewImportAction, undoImportAction } from "@/app/actions/import";
import { NeoHelp } from "./neo-help";

export interface ImportAccount {
  id: string;
  name: string;
  type: string;
  mask: string | null;
  institution: string | null;
}

type Step = "file" | "map" | "review" | "done";
type PreviewResult = Extract<Awaited<ReturnType<typeof previewImportAction>>, { ok: true }>["data"];
type CommitResult = Extract<Awaited<ReturnType<typeof commitImportAction>>, { ok: true }>["data"];

const NEW_ACCOUNT_TYPES = [
  { value: "CREDIT_CARD", label: "Credit card" },
  { value: "CHEQUING", label: "Chequing / everyday account" },
  { value: "SAVINGS", label: "Savings account" },
  { value: "LINE_OF_CREDIT", label: "Line of credit" },
  { value: "CASH", label: "Cash" },
];

const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  auto: "Detect automatically",
  "YYYY-MM-DD": "2026-09-30 (year-month-day)",
  "MM/DD/YYYY": "09/30/2026 (month first)",
  "DD/MM/YYYY": "30/09/2026 (day first)",
  "YYYY/MM/DD": "2026/09/30",
};

const MAPPED_KEYS = ["date", "description", "amount", "debit", "credit", "type", "status", "merchant", "category"] as const;

const STEPS: { key: Step; label: string }[] = [
  { key: "file", label: "Choose file" },
  { key: "map", label: "Match columns" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

/** Sends only the mapped columns (smaller request, and nothing the import doesn't need). */
function compactPayload(rows: string[][], mapping: ImportMapping) {
  const used = [...new Set(MAPPED_KEYS.map((k) => mapping[k]).filter((v): v is number => typeof v === "number"))].sort((a, b) => a - b);
  const index = new Map(used.map((c, i) => [c, i]));
  const next = { ...mapping } as ImportMapping;
  for (const k of MAPPED_KEYS) {
    const v = mapping[k];
    if (typeof v === "number") (next as Record<string, unknown>)[k] = index.get(v)!;
  }
  return { mapping: next, rows: rows.map((r) => used.map((c) => (r[c] ?? "").slice(0, 500))) };
}

function parseFile(file: File, encoding?: string): Promise<{ rows: string[][]; garbled: boolean }> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      encoding,
      complete: (res) => {
        const rows = res.data.map((r) => r.map((c) => (c ?? "").toString()));
        // Drop trailing empty columns some exports add.
        const width = Math.max(0, ...rows.map((r) => r.reduce((w, c, i) => (c.trim() ? i + 1 : w), 0)));
        resolve({ rows: rows.map((r) => r.slice(0, width)), garbled: rows.some((r) => r.some((c) => c.includes("�"))) });
      },
      error: (err) => reject(err),
    });
  });
}

export function ImportWizard({ accounts: initialAccounts, defaultAccountId }: { accounts: ImportAccount[]; defaultAccountId?: string }) {
  const router = useRouter();
  const f = useFormat();
  const [step, setStep] = React.useState<Step>("file");
  const [accounts, setAccounts] = React.useState(initialAccounts);
  const [accountId, setAccountId] = React.useState(defaultAccountId ?? initialAccounts[0]?.id ?? "");
  const [creating, setCreating] = React.useState(initialAccounts.length === 0);
  const [newAccount, setNewAccount] = React.useState({ name: "", type: "CREDIT_CARD", institutionName: "", balanceCents: null as number | null });
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<string[][]>([]);
  const [hasHeader, setHasHeader] = React.useState(true);
  const [mapping, setMapping] = React.useState<ImportMapping | null>(null);
  const [invertSuggested, setInvertSuggested] = React.useState(false);
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);
  const [result, setResult] = React.useState<CommitResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const account = accounts.find((a) => a.id === accountId);
  const header = hasHeader ? (rows[0] ?? []) : [];
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
  const columnOptions = Array.from({ length: width }, (_, i) => {
    const name = header[i]?.trim();
    const sample = rows[hasHeader ? 1 : 0]?.[i]?.trim();
    return { value: String(i), label: `${name || `Column ${i + 1}`}${sample ? ` — e.g. ${sample.slice(0, 24)}` : ""}` };
  });

  const localRows = React.useMemo(() => (mapping ? normalizeImportRows(rows, mapping, hasHeader) : []), [rows, mapping, hasHeader]);
  const localErrors = localRows.filter((r) => r.errors.length).length;
  const localSkipped = localRows.filter((r) => !r.errors.length && r.skipReason).length;

  const createAccount = async () => {
    setError(null);
    if (!newAccount.name.trim()) {
      setError("Give the new account a name.");
      return null;
    }
    const liability = ["CREDIT_CARD", "LINE_OF_CREDIT"].includes(newAccount.type);
    const res = await createImportAccountAction({ name: newAccount.name, type: newAccount.type as Parameters<typeof createImportAccountAction>[0]["type"], institutionName: newAccount.institutionName || undefined, balanceCents: newAccount.balanceCents ?? 0 });
    if (!res.ok) {
      setError(res.error.message);
      return null;
    }
    const created: ImportAccount = { id: res.data.id, name: res.data.name, type: res.data.type, mask: null, institution: newAccount.institutionName || null };
    setAccounts((list) => [...list, created]);
    setAccountId(created.id);
    setCreating(false);
    toast.success(`Created ${created.name}`, { description: liability ? "Balance entered as the amount owed." : undefined });
    return created;
  };

  const onFile = async (file: File) => {
    setError(null);
    if (!/\.(csv|txt)$/i.test(file.name) && !/csv|text\/plain/.test(file.type)) {
      setError("Choose a .csv file. Most banks call it “CSV” or “spreadsheet” in their download options.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("That file is larger than 5 MB. Export a shorter date range and import it in parts.");
      return;
    }
    let target = account;
    if (creating) {
      target = (await createAccount()) ?? undefined;
      if (!target) return;
    }
    if (!target) {
      setError("Choose the account this file belongs to first.");
      return;
    }
    setBusy(true);
    try {
      let parsed = await parseFile(file);
      // Older French exports are often Windows-1252 rather than UTF-8.
      if (parsed.garbled) parsed = await parseFile(file, "windows-1252");
      const data = parsed.rows.filter((r) => r.some((c) => c.trim()));
      if (data.length < 1) throw new Error("This file doesn't contain any rows.");
      const header = looksLikeHeader(data[0]);
      if (data.length - (header ? 1 : 0) > MAX_IMPORT_ROWS) throw new Error(`This file has more than ${MAX_IMPORT_ROWS.toLocaleString(f.locale)} transactions. Export a shorter date range and import it in parts.`);
      const guess = header ? guessMapping(data[0]) : { date: 0, description: 1, amount: 2 };
      const base: ImportMapping = {
        date: guess.date ?? 0,
        description: guess.description ?? 1,
        amount: guess.amount ?? (guess.debit == null && guess.credit == null ? 2 : null),
        debit: guess.debit ?? null,
        credit: guess.credit ?? null,
        type: guess.type ?? null,
        status: guess.status ?? null,
        merchant: guess.merchant ?? null,
        category: guess.category ?? null,
        dateFormat: detectDateFormat(data, guess.date ?? 0, header),
        invertAmounts: false,
      };
      const invert = suggestInvertAmounts(data, base, header, target.type);
      setRows(data);
      setHasHeader(header);
      setMapping({ ...base, invertAmounts: invert });
      setInvertSuggested(invert);
      setFileName(file.name);
      setStep("map");
    } catch (e) {
      setError(e instanceof Error ? e.message : "This file couldn't be read as CSV.");
    } finally {
      setBusy(false);
    }
  };

  const setMap = (patch: Partial<ImportMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));
  const column = (v: string) => (v === "" ? null : Number(v));

  const payload = () => {
    const compact = compactPayload(rows, mapping!);
    return { accountId, fileName: fileName ?? undefined, hasHeader, ...compact };
  };

  const runPreview = async () => {
    if (!mapping) return;
    setBusy(true);
    setError(null);
    const res = await previewImportAction(payload());
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setPreview(res.data);
    setStep("review");
  };

  const runImport = async () => {
    if (!mapping) return;
    setBusy(true);
    setError(null);
    const res = await commitImportAction(payload());
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setResult(res.data);
    setStep("done");
    router.refresh();
  };

  const undo = async () => {
    if (!result) return;
    setBusy(true);
    const res = await undoImportAction({ batchId: result.batchId });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Removed ${res.data.removed} imported ${res.data.removed === 1 ? "transaction" : "transactions"}`);
    reset();
    router.refresh();
  };

  const reset = () => {
    setStep("file");
    setRows([]);
    setMapping(null);
    setPreview(null);
    setResult(null);
    setFileName(null);
    setError(null);
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="space-y-4">
      <ol className="flex items-center gap-2 overflow-x-auto text-xs font-medium" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex shrink-0 items-center gap-2" aria-current={i === stepIndex ? "step" : undefined}>
            <span className={cn("flex size-6 items-center justify-center rounded-full border text-[11px]", i < stepIndex || step === "done" ? "border-primary bg-primary text-primary-foreground" : i === stepIndex ? "border-primary text-primary" : "border-border text-muted-foreground")}>
              {i < stepIndex || step === "done" ? "✓" : i + 1}
            </span>
            <span className={i === stepIndex ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
            {i < STEPS.length - 1 ? <span className="h-px w-6 bg-border" aria-hidden /> : null}
          </li>
        ))}
      </ol>

      <FormError message={error} />

      {step === "file" ? (
        <>
          <Card>
            <CardHeading title="Which account is this file for?" description="Transactions are added to this account. Its balance isn't changed by importing." />
            <CardContent className="space-y-3">
              {!creating ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select aria-label="Account" className="sm:max-w-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)} options={accounts.map((a) => ({ value: a.id, label: [a.name, a.mask ? `••${a.mask}` : null, a.institution ? `· ${a.institution}` : null].filter(Boolean).join(" ") }))} />
                  <Button variant="outline" onClick={() => setCreating(true)}>
                    <Plus /> New account
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-border bg-subtle p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Account name" required>
                      <Input value={newAccount.name} onChange={(e) => setNewAccount((s) => ({ ...s, name: e.target.value }))} placeholder="e.g. Neo credit card" maxLength={60} />
                    </Field>
                    <Field label="Type">
                      <Select value={newAccount.type} onChange={(e) => setNewAccount((s) => ({ ...s, type: e.target.value }))} options={NEW_ACCOUNT_TYPES} />
                    </Field>
                    <Field label="Bank" hint="Optional">
                      <Input value={newAccount.institutionName} onChange={(e) => setNewAccount((s) => ({ ...s, institutionName: e.target.value }))} placeholder="e.g. Neo Financial" maxLength={60} />
                    </Field>
                    <Field label={["CREDIT_CARD", "LINE_OF_CREDIT"].includes(newAccount.type) ? "Amount owed today" : "Current balance"} hint="Optional. You can update it any time.">
                      <CurrencyInput value={newAccount.balanceCents} onChange={(c) => setNewAccount((s) => ({ ...s, balanceCents: c }))} currency={f.currency} locale={f.locale} placeholder="0.00" />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    {accounts.length ? (
                      <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                        Use an existing account
                      </Button>
                    ) : null}
                    <p className="ml-auto self-center text-xs text-muted-foreground">The account is created when you choose a file.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeading title="Choose the CSV file" description="The file is read in your browser; only the columns you match are sent to Harbour." />
            <CardContent className="space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void onFile(file);
                }}
                className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors", dragging ? "border-primary bg-primary-soft/40" : "border-border bg-subtle")}
              >
                <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <FileSpreadsheet className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-medium">Drop your CSV file here</p>
                  <p className="text-xs text-muted-foreground">or</p>
                </div>
                <Button onClick={() => inputRef.current?.click()} loading={busy}>
                  <Upload /> Choose a file
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="sr-only"
                  aria-label="CSV file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void onFile(file);
                  }}
                />
                <p className="text-xs text-muted-foreground">Up to {MAX_IMPORT_ROWS.toLocaleString(f.locale)} transactions per file.</p>
              </div>
              <NeoHelp />
            </CardContent>
          </Card>
        </>
      ) : null}

      {step === "map" && mapping ? (
        <Card>
          <CardHeading
            title="Match the columns"
            description={
              <>
                {fileName} · {(rows.length - (hasHeader ? 1 : 0)).toLocaleString(f.locale)} rows · into <span className="font-medium text-foreground">{account?.name}</span>
              </>
            }
          />
          <CardContent className="space-y-5">
            <div className="flex items-center gap-2">
              <Checkbox id="has-header" checked={hasHeader} onCheckedChange={(c) => setHasHeader(c === true)} />
              <Label htmlFor="has-header" className="font-normal">
                The first row contains column names
              </Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Date" required>
                <Select value={String(mapping.date)} onChange={(e) => setMap({ date: Number(e.target.value) })} options={columnOptions} />
              </Field>
              <Field label="Description" required>
                <Select value={String(mapping.description)} onChange={(e) => setMap({ description: Number(e.target.value) })} options={columnOptions} />
              </Field>
              <Field label="Date format">
                <Select value={mapping.dateFormat} onChange={(e) => setMap({ dateFormat: e.target.value as DateFormat })} options={DATE_FORMATS.map((d) => ({ value: d, label: DATE_FORMAT_LABELS[d] }))} />
              </Field>
            </div>

            <div className="space-y-3">
              <Segmented
                aria-label="How amounts are shown"
                value={mapping.amount !== null && mapping.amount !== undefined ? "single" : "split"}
                onChange={(v) => setMap(v === "single" ? { amount: mapping.debit ?? mapping.credit ?? 0, debit: null, credit: null } : { amount: null, debit: mapping.amount ?? 0, credit: null, type: null })}
                options={[
                  { value: "single", label: "One amount column" },
                  { value: "split", label: "Separate in / out columns" },
                ]}
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mapping.amount !== null && mapping.amount !== undefined ? (
                  <>
                    <Field label="Amount" required>
                      <Select value={String(mapping.amount)} onChange={(e) => setMap({ amount: Number(e.target.value) })} options={columnOptions} />
                    </Field>
                    <Field label="Debit / credit column" hint="Only used when every amount is positive.">
                      <Select value={mapping.type === null || mapping.type === undefined ? "" : String(mapping.type)} onChange={(e) => setMap({ type: column(e.target.value) })} placeholder="None" options={columnOptions} />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Money out (debits)">
                      <Select value={mapping.debit === null || mapping.debit === undefined ? "" : String(mapping.debit)} onChange={(e) => setMap({ debit: column(e.target.value) })} placeholder="None" options={columnOptions} />
                    </Field>
                    <Field label="Money in (credits)">
                      <Select value={mapping.credit === null || mapping.credit === undefined ? "" : String(mapping.credit)} onChange={(e) => setMap({ credit: column(e.target.value) })} placeholder="None" options={columnOptions} />
                    </Field>
                  </>
                )}
              </div>
            </div>

            <details className="rounded-xl border border-border px-4 py-3 text-[13px]" open={mapping.status != null || mapping.merchant != null || mapping.category != null}>
              <summary className="cursor-pointer font-medium">Optional columns</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Status" hint="Pending and declined rows are skipped.">
                  <Select value={mapping.status == null ? "" : String(mapping.status)} onChange={(e) => setMap({ status: column(e.target.value) })} placeholder="None" options={columnOptions} />
                </Field>
                <Field label="Merchant">
                  <Select value={mapping.merchant == null ? "" : String(mapping.merchant)} onChange={(e) => setMap({ merchant: column(e.target.value) })} placeholder="None" options={columnOptions} />
                </Field>
                <Field label="Bank category" hint="Used as a hint; your own rules win.">
                  <Select value={mapping.category == null ? "" : String(mapping.category)} onChange={(e) => setMap({ category: column(e.target.value) })} placeholder="None" options={columnOptions} />
                </Field>
              </div>
            </details>

            <div className="flex items-start justify-between gap-4 rounded-xl border border-border px-4 py-3">
              <div>
                <Label htmlFor="invert">Purchases are shown as positive numbers</Label>
                <p className="text-xs text-muted-foreground">Turn on if spending shows up as money in below. Common for credit card exports.</p>
                {invertSuggested ? <p className="mt-1 text-xs font-medium text-info">Turned on because most amounts in this credit card file are positive.</p> : null}
              </div>
              <Switch id="invert" checked={mapping.invertAmounts} onCheckedChange={(v) => setMap({ invertAmounts: v })} />
            </div>

            <div>
              <h3 className="text-[13px] font-semibold">Preview</h3>
              <p className="text-xs text-muted-foreground">How the first rows will be read. Money out is negative.</p>
              <div className="mt-2 overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-32 text-right">Amount</TableHead>
                      <TableHead className="w-40">Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {localRows.slice(0, 8).map((r) => (
                      <TableRow key={r.line}>
                        <TableCell className="tabular whitespace-nowrap">{r.date ? f.date(r.date) : <span className="text-danger">?</span>}</TableCell>
                        <TableCell className="max-w-0 truncate">{r.description || <span className="text-danger">Missing</span>}</TableCell>
                        <TableCell className={cn("tabular whitespace-nowrap text-right font-medium", (r.amountCents ?? 0) > 0 && "text-positive")}>{r.amountCents === null ? <span className="text-danger">?</span> : f.money(r.amountCents, { signed: r.amountCents > 0 })}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.errors.length ? <span className="text-danger">{r.errors.join(", ")}</span> : (r.skipReason ?? "")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {localErrors ? (
                <Notice tone="warning" className="mt-3">
                  {localErrors.toLocaleString(f.locale)} of {localRows.length.toLocaleString(f.locale)} rows can&apos;t be read with these settings. Check the date format and the amount columns. Rows that still can&apos;t be read are left out.
                </Notice>
              ) : null}
              {localSkipped ? <p className="mt-2 text-xs text-muted-foreground">{localSkipped.toLocaleString(f.locale)} pending or declined rows will be skipped. Pending ones come back in a later export once they post.</p> : null}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={reset}>
                <ArrowLeft /> Choose another file
              </Button>
              <Button onClick={runPreview} loading={busy} disabled={localRows.length === 0 || localErrors === localRows.length}>
                Check for duplicates
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "review" && preview ? (
        <Card>
          <CardHeading title="Review" description={`${fileName} into ${account?.name ?? "your account"}`} />
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "New", value: preview.counts.new, tone: "text-positive" },
                { label: "Already here", value: preview.counts.duplicate, tone: "text-muted-foreground" },
                { label: "Skipped", value: preview.counts.skipped, tone: "text-muted-foreground" },
                { label: "Can't read", value: preview.counts.error, tone: preview.counts.error ? "text-danger" : "text-muted-foreground" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-border px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">{s.label}</dt>
                  <dd className={cn("tabular text-xl font-semibold", s.tone)}>{s.value.toLocaleString(f.locale)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">Transactions already in this account are recognised and skipped, so importing overlapping files is safe. After importing, Harbour categorises everything and runs your automations.</p>
            <div className="max-h-96 overflow-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-32 text-right">Amount</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r) => (
                    <TableRow key={r.line}>
                      <TableCell className="tabular whitespace-nowrap">{r.date ? f.date(r.date) : "—"}</TableCell>
                      <TableCell className="max-w-0 truncate">{r.description}</TableCell>
                      <TableCell className="tabular whitespace-nowrap text-right">{r.amountCents === null ? "—" : f.money(r.amountCents, { signed: r.amountCents > 0 })}</TableCell>
                      <TableCell>
                        {r.status === "new" ? (
                          <Badge variant="positive">New</Badge>
                        ) : r.status === "duplicate" ? (
                          <Badge variant="neutral">Already here</Badge>
                        ) : r.status === "skipped" ? (
                          <Badge variant="outline">{r.skipReason ?? "Skipped"}</Badge>
                        ) : (
                          <Badge variant="danger" title={r.errors.join(", ")}>
                            {r.errors[0] ?? "Error"}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {preview.counts.total > preview.rows.length ? <p className="text-xs text-muted-foreground">Showing the first {preview.rows.length} of {preview.counts.total.toLocaleString(f.locale)} rows.</p> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={() => setStep("map")}>
                <ArrowLeft /> Back
              </Button>
              <Button onClick={runImport} loading={busy} disabled={preview.counts.new === 0}>
                <FileUp /> {preview.counts.new === 0 ? "Nothing new to import" : `Import ${preview.counts.new.toLocaleString(f.locale)} ${preview.counts.new === 1 ? "transaction" : "transactions"}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "done" && result ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-positive-soft text-positive">
              <CheckCircle2 className="size-6" aria-hidden />
            </span>
            <div>
              <p className="text-base font-semibold">
                Imported {result.imported.toLocaleString(f.locale)} {result.imported === 1 ? "transaction" : "transactions"}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {[result.duplicates ? `${result.duplicates.toLocaleString(f.locale)} already here` : null, result.skipped ? `${result.skipped.toLocaleString(f.locale)} pending or declined skipped` : null, result.errors ? `${result.errors.toLocaleString(f.locale)} couldn't be read` : null]
                  .filter(Boolean)
                  .join(" · ") || "Everything in the file was new."}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href={`/transactions?account=${accountId}`}>View transactions</Link>
              </Button>
              <Button variant="outline" onClick={reset}>
                Import another file
              </Button>
              <Button variant="ghost" onClick={undo} loading={busy}>
                Undo this import
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
