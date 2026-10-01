"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, ChevronLeft, ChevronRight, FileUp, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryIcon } from "@/components/shared/category-icon";
import { EmptyState } from "@/components/shared/empty-state";
import { useFormat } from "@/components/providers/format-provider";
import { cn } from "@/lib/utils";
import { FILTER_PARAMS, filterParamValue } from "@/lib/transactions/url";
import type { TransactionFilters } from "@/lib/transactions/schemas";
import type { TransactionDTO } from "@/lib/transactions/service";
import { bulkCategorizeAction } from "@/app/actions/transactions";
import type { QuickAddOptions } from "@/app/actions/shell";
import { CategoryOptions } from "./category-options";
import { FiltersDialog, TYPE_LABELS, type FilterValues } from "./filters-dialog";
import { TransactionDrawer } from "./transaction-drawer";

export interface TransactionsViewProps {
  rows: TransactionDTO[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  totals: { inflow: number; outflow: number };
  filters: TransactionFilters;
  activeCount: number;
  accounts: { id: string; name: string; mask: string | null }[];
  categories: QuickAddOptions["categories"];
  tags: { id: string; name: string }[];
  openId: string | null;
}

const SORT_OPTIONS = [
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
  { value: "amount_asc", label: "Largest spending first" },
  { value: "amount_desc", label: "Largest deposits first" },
  { value: "merchant_asc", label: "Name A–Z" },
];

const FILTER_KEYS = ["accountId", "categoryId", "type", "tagId", "from", "to", "minCents", "maxCents", "pending", "review"] as const;

export function TransactionsView(props: TransactionsViewProps) {
  const { rows, total, page, pageCount, pageSize, totals, filters, activeCount, accounts, categories, tags } = props;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const f = useFormat();
  const [isPending, startTransition] = React.useTransition();
  const [query, setQuery] = React.useState(filters.q ?? "");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = React.useState("");
  const [bulkSaving, setBulkSaving] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(props.openId);

  // Selection only makes sense for the rows on screen.
  React.useEffect(() => setSelected(new Set()), [rows]);
  React.useEffect(() => setQuery(filters.q ?? ""), [filters.q]);

  const navigate = React.useCallback(
    (patch: Record<string, string | null>, { keepPage = false } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (!keepPage) next.delete(FILTER_PARAMS.page);
      next.delete("txn");
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  // Debounced search.
  React.useEffect(() => {
    const q = query.trim();
    if (q === (filters.q ?? "")) return;
    const t = setTimeout(() => navigate({ [FILTER_PARAMS.q]: q || null }), 350);
    return () => clearTimeout(t);
  }, [query, filters.q, navigate]);

  // The drawer is reflected in the URL (?txn=) without a server round trip.
  const openTransaction = (id: string | null) => {
    setOpenId(id);
    const next = new URLSearchParams(window.location.search);
    if (id) next.set("txn", id);
    else next.delete("txn");
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };

  const applyFilters = (v: FilterValues) => {
    const patch: Record<string, string | null> = {};
    for (const key of FILTER_KEYS) patch[FILTER_PARAMS[key]] = filterParamValue(key, v[key]);
    navigate(patch);
  };

  const filterValues: FilterValues = {
    accountId: typeof filters.accountId === "string" ? filters.accountId : undefined,
    categoryId: typeof filters.categoryId === "string" ? filters.categoryId : undefined,
    type: filters.type,
    tagId: filters.tagId,
    from: filters.from,
    to: filters.to,
    minCents: filters.minCents,
    maxCents: filters.maxCents,
    pending: filters.pending,
    review: filters.review,
  };

  const chips = buildChips(filterValues, { accounts, categories, tags, money: f.money, date: (d) => f.date(d, "monthDay") });

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const applyBulk = async () => {
    if (!selected.size) return;
    setBulkSaving(true);
    const res = await bulkCategorizeAction({ ids: [...selected], categoryId: bulkCategory === "uncategorized" ? null : bulkCategory });
    setBulkSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Updated ${res.data.count} ${res.data.count === 1 ? "transaction" : "transactions"}`);
    setSelected(new Set());
    setBulkCategory("");
    router.refresh();
  };

  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(total, page * pageSize);
  const groups = groupByDate(rows);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, description or note" aria-label="Search transactions" className="pl-9" maxLength={100} />
        </div>
        <FiltersDialog value={filterValues} activeCount={activeCount} onApply={applyFilters} accounts={accounts} categories={categories} tags={tags} />
        <Select aria-label="Sort" className="hidden w-52 shrink-0 md:block" value={filters.sort} onChange={(e) => navigate({ [FILTER_PARAMS.sort]: e.target.value === "date_desc" ? null : e.target.value })} options={SORT_OPTIONS} />
      </div>

      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => navigate(Object.fromEntries(c.params.map((p) => [p, null])))}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium shadow-soft transition-colors hover:bg-accent"
              aria-label={`Remove filter: ${c.label}`}
            >
              {c.label}
              <X className="size-3.5 text-muted-foreground" aria-hidden />
            </button>
          ))}
          <Button variant="link" size="sm" className="text-xs" onClick={() => applyFilters({})}>
            Clear all
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
        <p aria-live="polite">
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Updating…
            </span>
          ) : (
            <>
              {total.toLocaleString(f.locale)} {total === 1 ? "transaction" : "transactions"}
            </>
          )}
        </p>
        {total > 0 ? (
          <p className="tabular">
            In <span className="font-medium text-positive">{f.money(totals.inflow)}</span> · Out <span className="font-medium text-foreground">{f.money(totals.outflow)}</span>
            <span className="hidden sm:inline"> · transfers not counted</span>
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={ArrowLeftRight}
            title={activeCount || filters.q ? "No transactions match" : "No transactions yet"}
            description={activeCount || filters.q ? "Try a different search or clear some filters." : "Import a CSV from your bank, connect an account, or add one by hand."}
            action={
              activeCount || filters.q ? (
                <Button variant="outline" onClick={() => (setQuery(""), navigate({ ...Object.fromEntries(FILTER_KEYS.map((k) => [FILTER_PARAMS[k], null])), [FILTER_PARAMS.q]: null }))}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/transactions/import">
                    <FileUp /> Import a CSV
                  </Link>
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card className={cn("overflow-clip transition-opacity", isPending && "opacity-60")}>
          {/* Desktop: table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    <Checkbox aria-label="Select all on this page" checked={allSelected} onCheckedChange={(c) => setSelected(c === true ? new Set(rows.map((r) => r.id)) : new Set())} />
                  </TableHead>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-48">Category</TableHead>
                  <TableHead className="w-44">Account</TableHead>
                  <TableHead className="w-32 pr-4 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} data-state={selected.has(t.id) ? "selected" : undefined} className={cn("cursor-pointer", t.isExcluded && "opacity-60")} onClick={() => openTransaction(t.id)}>
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label={`Select ${t.merchantName}`} checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} />
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap text-muted-foreground">{f.date(t.date, "monthDay")}</TableCell>
                    <TableCell className="max-w-0">
                      <button type="button" className="block w-full truncate text-left font-medium outline-none hover:underline focus-visible:underline" onClick={(e) => (e.stopPropagation(), openTransaction(t.id))}>
                        {t.merchantName}
                      </button>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {t.isPending ? <span className="font-medium text-warning">Pending</span> : null}
                        {t.isTransfer ? <span>Transfer</span> : null}
                        {t.isRecurring ? <span>Recurring</span> : null}
                        {t.notes ? <span className="truncate">“{t.notes}”</span> : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex min-w-0 items-center gap-2">
                        <CategoryIcon icon={t.category?.icon} color={t.category?.color} size="sm" />
                        <span className={cn("truncate", !t.category && "text-muted-foreground")}>{t.category?.name ?? "Uncategorized"}</span>
                      </span>
                    </TableCell>
                    <TableCell className="max-w-0 truncate text-muted-foreground">{t.account.name}</TableCell>
                    <TableCell className={cn("tabular whitespace-nowrap pr-4 text-right font-medium", t.amountCents > 0 && !t.isTransfer && "text-positive")}>{f.money(t.amountCents, { signed: t.amountCents > 0 })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Phones: list grouped by day */}
          <div className="md:hidden">
            {groups.map((g) => (
              <section key={g.date} aria-labelledby={`day-${g.date}`}>
                <h3 id={`day-${g.date}`} className="sticky top-14 z-[1] border-b border-border bg-subtle/95 px-4 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur">
                  {f.relative(g.date)}
                  {f.relative(g.date) !== f.date(g.date, "monthDay") ? <span className="font-normal"> · {f.date(g.date, "monthDay")}</span> : null}
                </h3>
                <ul className="divide-y divide-border">
                  {g.rows.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => openTransaction(t.id)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent", t.isExcluded && "opacity-60")}>
                        <CategoryIcon icon={t.category?.icon} color={t.category?.color} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{t.merchantName}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {t.isPending ? <span className="font-medium text-warning">Pending · </span> : null}
                            {t.category?.name ?? "Uncategorized"} · {t.account.name}
                          </span>
                        </span>
                        <span className={cn("tabular text-sm font-medium", t.amountCents > 0 && !t.isTransfer && "text-positive")}>{f.money(t.amountCents, { signed: t.amountCents > 0 })}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Card>
      )}

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Pages">
          <p className="tabular text-[13px] text-muted-foreground">
            {firstRow.toLocaleString(f.locale)}–{lastRow.toLocaleString(f.locale)} of {total.toLocaleString(f.locale)}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || isPending} onClick={() => navigate({ [FILTER_PARAMS.page]: page - 1 > 1 ? String(page - 1) : null }, { keepPage: true })}>
              <ChevronLeft /> Previous
            </Button>
            <span className="tabular text-[13px] text-muted-foreground">
              {page} / {pageCount}
            </span>
            <Button variant="outline" size="sm" disabled={page >= pageCount || isPending} onClick={() => navigate({ [FILTER_PARAMS.page]: String(page + 1) }, { keepPage: true })}>
              Next <ChevronRight />
            </Button>
          </div>
        </nav>
      ) : null}

      {selected.size ? (
        <div className="fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-2xl border border-border bg-popover p-3 shadow-pop md:bottom-6" role="region" aria-label="Bulk actions">
          <p className="text-sm font-medium">{selected.size} selected</p>
          <Select aria-label="New category" className="min-w-40 flex-1" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} placeholder="Choose a category…">
            <option value="uncategorized">Uncategorized</option>
            <CategoryOptions categories={categories} />
          </Select>
          <Button onClick={applyBulk} loading={bulkSaving} disabled={!bulkCategory}>
            Apply
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Cancel
          </Button>
        </div>
      ) : null}

      <TransactionDrawer id={openId} onClose={() => openTransaction(null)} categories={categories} />
    </div>
  );
}

function groupByDate(rows: TransactionDTO[]) {
  const out: { date: string; rows: TransactionDTO[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.date === r.date) last.rows.push(r);
    else out.push({ date: r.date, rows: [r] });
  }
  return out;
}

function buildChips(
  v: FilterValues,
  ctx: { accounts: { id: string; name: string }[]; categories: { id: string; name: string }[]; tags: { id: string; name: string }[]; money: (c: number) => string; date: (d: string) => string },
) {
  const chips: { key: string; label: string; params: string[] }[] = [];
  if (v.from || v.to) chips.push({ key: "dates", label: v.from && v.to ? `${ctx.date(v.from)} – ${ctx.date(v.to)}` : v.from ? `From ${ctx.date(v.from)}` : `Until ${ctx.date(v.to!)}`, params: [FILTER_PARAMS.from, FILTER_PARAMS.to] });
  if (v.accountId) chips.push({ key: "account", label: ctx.accounts.find((a) => a.id === v.accountId)?.name ?? "Account", params: [FILTER_PARAMS.accountId] });
  if (v.categoryId) chips.push({ key: "category", label: v.categoryId === "uncategorized" ? "Uncategorized" : (ctx.categories.find((c) => c.id === v.categoryId)?.name ?? "Category"), params: [FILTER_PARAMS.categoryId] });
  if (v.type) chips.push({ key: "type", label: TYPE_LABELS[v.type] ?? v.type, params: [FILTER_PARAMS.type] });
  if (v.tagId) chips.push({ key: "tag", label: `#${ctx.tags.find((t) => t.id === v.tagId)?.name ?? "tag"}`, params: [FILTER_PARAMS.tagId] });
  if (v.minCents !== undefined || v.maxCents !== undefined)
    chips.push({
      key: "amount",
      label: v.minCents !== undefined && v.maxCents !== undefined ? `${ctx.money(v.minCents)} – ${ctx.money(v.maxCents)}` : v.minCents !== undefined ? `At least ${ctx.money(v.minCents)}` : `At most ${ctx.money(v.maxCents!)}`,
      params: [FILTER_PARAMS.minCents, FILTER_PARAMS.maxCents],
    });
  if (v.pending) chips.push({ key: "pending", label: v.pending === "true" ? "Pending only" : "Posted only", params: [FILTER_PARAMS.pending] });
  if (v.review) chips.push({ key: "review", label: "Needs a category", params: [FILTER_PARAMS.review] });
  return chips;
}
