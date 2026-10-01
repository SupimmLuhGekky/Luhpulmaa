"use client";

import Link from "next/link";
import { ChartColumn, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Notice } from "@/components/shared/notice";
import { PageHeader } from "@/components/shared/page-header";
import { useFormat } from "@/components/providers/format-provider";
import type { Analytics } from "@/lib/analytics/service";
import { cn } from "@/lib/utils";
import { AnalyticsFilters, type AppliedQuery, type ParamPatch } from "./analytics-filters";
import { CategoryBreakdownCard, CategoryChangesCard } from "./category-cards";
import { formatDateRange, PREVIOUS_LABEL, previousFullPeriod } from "./format";
import { IncomeSpendingCard } from "./income-spending-card";
import { InsightsCard } from "./insights-card";
import { AnalyticsKpis } from "./kpis";
import { MerchantsCard } from "./merchants-card";
import type { FilterGroup } from "./multi-select-filter";
import { useParamNavigation } from "./use-param-navigation";

export interface AnalyticsViewProps {
  data: Analytics;
  applied: AppliedQuery;
  accountGroups: FilterGroup[];
  categoryGroups: FilterGroup[];
}

/** "Groceries", "Groceries and Gas", "Groceries, Gas and 3 more". */
function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

const CLEAR_FILTERS: ParamPatch = { accounts: null, categories: null };

/**
 * Analytics: filters, headline figures with changes vs the comparison period, income
 * and spending over time, factual insights, and where the money went (categories,
 * changes, merchants). All figures come from lib/analytics for the URL's filters.
 */
export function AnalyticsView({ data, applied, accountGroups, categoryGroups }: AnalyticsViewProps) {
  const fmt = useFormat();
  const { navigate, pending } = useParamNavigation();
  const change = (patch: ParamPatch) => navigate(patch, { replace: true });
  const r = data.range;
  const m = data.metrics;
  const scoped = data.filters.scoped;
  const hasHistory = r.dataSince !== null;
  const emptyPeriod = m.income === 0 && m.spending === 0 && data.categoryBreakdown.length === 0;
  const accountParam = applied.accounts.length === 1 ? applied.accounts[0] : undefined;
  const changed = scoped || applied.range !== "month";

  const nameOf = (groups: FilterGroup[], ids: string[]) => {
    const all = groups.flatMap((g) => g.options);
    return ids.map((id) => all.find((o) => o.id === id)?.name).filter((n): n is string => Boolean(n));
  };
  const scopeText = [
    applied.accounts.length ? listNames(nameOf(accountGroups, applied.accounts)) : "all accounts",
    applied.categories.length ? listNames(nameOf(categoryGroups, applied.categories)) : "all categories",
  ].join(" · ");

  const previous = previousFullPeriod(r, applied.range);
  // A period that ends before the first transaction can only be empty: offer the history instead.
  const beforeHistory = r.dataSince !== null && r.to < r.dataSince;

  return (
    <>
      <PageHeader title="Analytics" description="Where your money comes from and where it goes, calculated from your own transactions." />
      {/* Without any transactions there is nothing to filter yet. */}
      {hasHistory || scoped ? (
        <>
          <AnalyticsFilters applied={applied} accountGroups={accountGroups} categoryGroups={categoryGroups} onChange={change} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-[13px] text-muted-foreground" aria-live="polite">
              <span className="font-medium text-foreground">{formatDateRange(r.from, r.to, fmt.locale)}</span>
              {hasHistory && r.comparison !== "none" ? (
                <>
                  {" "}
                  · compared with {r.comparisonLabel} ({formatDateRange(r.previousFrom, r.previousTo, fmt.locale)}
                  {r.comparison === "partial" && r.dataSince ? `; ${scoped ? "matching" : "your"} transactions start on ${fmt.date(r.dataSince, "monthDay")}` : ""})
                </>
              ) : null}
            </p>
            {changed ? (
              <Button variant="link" size="sm" className="h-auto p-0 text-[13px]" onClick={() => change({ range: null, from: null, to: null, ...CLEAR_FILTERS })}>
                Reset filters
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      <div className={cn("mt-4 space-y-4 transition-opacity duration-200", pending && "opacity-60")} aria-busy={pending || undefined}>
        {scoped ? (
          <Notice
            tone="info"
            title="Filtered view"
            action={
              <Button variant="outline" size="sm" onClick={() => change(CLEAR_FILTERS)}>
                Clear
              </Button>
            }
          >
            Showing {scopeText}. Transfers between your accounts are never counted.
          </Notice>
        ) : null}

        {!hasHistory ? (
          <Card>
            {scoped ? (
              <EmptyState
                icon={SearchX}
                title="No transactions match these filters"
                description="Try other accounts or categories, or clear the filters to see everything."
                action={<Button onClick={() => change(CLEAR_FILTERS)}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={ChartColumn}
                title="Nothing to analyze yet"
                description="Add an account or import transactions, and your income, spending and trends show up here."
                action={
                  <>
                    <Button asChild>
                      <Link href="/accounts/new">Add an account</Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/transactions/import">Import a CSV</Link>
                    </Button>
                  </>
                }
              />
            )}
          </Card>
        ) : emptyPeriod ? (
          <Card>
            <EmptyState
              icon={ChartColumn}
              title={`No transactions ${r.periodPhrase}`}
              description={
                beforeHistory && r.dataSince
                  ? `Your transactions${scoped ? " for these filters" : ""} start on ${fmt.date(r.dataSince, "medium")}.`
                  : `Nothing was recorded from ${formatDateRange(r.from, r.to, fmt.locale)}${scoped ? " for these filters" : ""}.`
              }
              action={
                beforeHistory && r.dataSince ? (
                  <Button variant="outline" onClick={() => change({ range: "custom", from: r.dataSince, to: fmt.today })}>
                    Show {fmt.date(r.dataSince, "monthDay")} to today
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => change({ range: "custom", from: previous.from, to: previous.to })}>
                    {PREVIOUS_LABEL[applied.range] ?? PREVIOUS_LABEL.custom}
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <>
            <AnalyticsKpis data={data} />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,3fr)] xl:items-start">
              <IncomeSpendingCard data={data} />
              <InsightsCard data={data} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start xl:grid-cols-3">
              <CategoryBreakdownCard data={data} accountParam={accountParam} />
              <CategoryChangesCard data={data} />
              <MerchantsCard data={data} accountParam={accountParam} className="lg:col-span-2 xl:col-span-1" />
            </div>
          </>
        )}
      </div>
    </>
  );
}
