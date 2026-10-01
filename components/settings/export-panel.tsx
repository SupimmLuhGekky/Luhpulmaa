"use client";

import * as React from "react";
import { toast } from "sonner";
import { Download, FileArchive, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { addDays, addMonths, type LocalDate } from "@/lib/dates";
import { EXPORT_INFO, exportFileName, type ExportType } from "@/lib/export/files";

type Period = "all" | "year" | "12m" | "custom";

const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "year", label: "This year" },
  { value: "12m", label: "Last 12 months" },
  { value: "custom", label: "Custom dates" },
];

/** Downloads the file with fetch so errors (like the hourly limit) can be shown instead of saved. */
async function downloadFile(url: string, fallbackName: string): Promise<string> {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) {
    let message = "The export couldn't be created. Please try again.";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
  return name;
}

const CSV_TYPES: Exclude<ExportType, "all">[] = ["transactions", "budget", "accounts", "goals", "contributions", "summary"];

export function ExportPanel({ today, locale, months }: { today: LocalDate; locale: string; months: { value: string; label: string }[] }) {
  const [busy, setBusy] = React.useState<ExportType | null>(null);
  const [period, setPeriod] = React.useState<Period>("all");
  const [from, setFrom] = React.useState<LocalDate | null>(addMonths(today, -3));
  const [to, setTo] = React.useState<LocalDate | null>(today);
  const [month, setMonth] = React.useState(months[0]?.value ?? today.slice(0, 7));
  const [rangeError, setRangeError] = React.useState<string | null>(null);

  const transactionRange = (): { from?: string; to?: string } | null => {
    switch (period) {
      case "all":
        return {};
      case "year":
        return { from: `${today.slice(0, 4)}-01-01`, to: today };
      case "12m":
        return { from: addDays(addMonths(today, -12), 1), to: today };
      case "custom":
        if (from && to && from > to) {
          setRangeError("The start date must be before the end date.");
          return null;
        }
        return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
    }
  };

  const run = async (type: ExportType) => {
    const params = new URLSearchParams({ type });
    let opts: { from?: string; to?: string; month?: string } = {};
    if (type === "transactions") {
      const range = transactionRange();
      if (!range) return;
      opts = range;
    } else if (type === "budget") {
      opts = { month };
    }
    for (const [k, v] of Object.entries(opts)) if (v) params.set(k, v);
    setRangeError(null);
    setBusy(type);
    try {
      const name = await downloadFile(`/api/export?${params.toString()}`, exportFileName(type, today, opts));
      toast.success("Download ready", { description: name });
    } catch (error) {
      toast.error("Export failed", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary-soft/50 p-4 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
          <FileArchive className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Everything</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{EXPORT_INFO.all.description}</p>
        </div>
        <Button onClick={() => run("all")} loading={busy === "all"} disabled={busy !== null && busy !== "all"} className="w-full sm:w-auto">
          {busy === "all" ? null : <Download />} Download ZIP
        </Button>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {CSV_TYPES.map((type) => {
          const info = EXPORT_INFO[type];
          return (
            <li key={type} className="flex items-start gap-3 p-3.5">
              <FileSpreadsheet className="mt-0.5 hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {info.label} <Badge variant="neutral">{info.format}</Badge>
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{info.description}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => run(type)}
                    loading={busy === type}
                    disabled={busy !== null && busy !== type}
                    aria-label={`Download ${info.label.toLowerCase()} as ${info.format}`}
                    className="shrink-0 px-2.5 sm:px-3"
                  >
                    {busy === type ? null : <Download />}
                    <span className="hidden sm:inline">Download</span>
                  </Button>
                </div>
                {/* Options use the row's full width, so long month names fit on phones. */}
                {type === "transactions" ? (
                  <div className="mt-2.5 space-y-2">
                    <Select aria-label="Transactions to include" value={period} onChange={(e) => setPeriod(e.target.value as Period)} options={PERIODS} className="w-full sm:w-64" />
                    {period === "custom" ? (
                      <div className="grid gap-2 sm:max-w-md sm:grid-cols-2">
                        <DatePicker value={from} onChange={setFrom} locale={locale} max={today} placeholder="From the start" clearable aria-label="Export from" aria-invalid={rangeError ? true : undefined} />
                        <DatePicker value={to} onChange={setTo} locale={locale} max={today} placeholder="Until today" clearable aria-label="Export until" aria-invalid={rangeError ? true : undefined} />
                      </div>
                    ) : null}
                    {rangeError ? (
                      <p role="alert" className="text-xs font-medium text-danger">
                        {rangeError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {type === "budget" ? (
                  <Select aria-label="Budget month" value={month} onChange={(e) => setMonth(e.target.value)} options={months} className="mt-2.5 w-full sm:w-64" />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
