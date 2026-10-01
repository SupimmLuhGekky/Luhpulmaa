"use client";

import { CalendarDays, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { useFormat } from "@/components/providers/format-provider";
import { useParamNavigation } from "@/components/analytics/use-param-navigation";
import type { CalendarView } from "@/lib/bills/calendar";
import type { LocalDate } from "@/lib/dates";
import { BillActionsProvider, useBillActions } from "./bill-actions";
import { BillCalendar, periodOf } from "./bill-calendar";
import { BillsTable } from "./bills-table";
import { MonthlyTotal, NeededBeforePayday, PeriodTotals } from "./bills-summary";
import { OverdueBills } from "./overdue-bills";
import type { BeforePayday, BillFormOptions, BillRow, Occurrence } from "./types";

export interface BillsViewProps {
  view: CalendarView;
  date: LocalDate;
  weekStartsOn: number;
  /** Occurrences for every date the current view shows. */
  occurrences: Occurrence[];
  beforePayday: BeforePayday;
  bills: BillRow[];
  recurring: { monthly: number; yearly: number; count: number };
  options: BillFormOptions;
  /** `?new=1`: open the add-bill dialog. */
  openNew: boolean;
}

function AddBillButton({ variant = "primary" }: { variant?: "primary" | "outline" }) {
  const { addBill } = useBillActions();
  return (
    <Button variant={variant} onClick={addBill}>
      <Plus /> Add bill
    </Button>
  );
}

function utc(d: LocalDate) {
  return new Date(`${d}T00:00:00Z`);
}

export function BillsView(props: BillsViewProps) {
  const { view, date, weekStartsOn, occurrences, beforePayday, bills, recurring, options, openNew } = props;
  const fmt = useFormat();
  const { navigate } = useParamNavigation();
  const period = periodOf(view, date, weekStartsOn);
  const periodOccurrences = occurrences.filter((o) => o.dueDate >= period.from && o.dueDate <= period.to);
  const sameYear = date.slice(0, 4) === fmt.today.slice(0, 4);
  const periodTitle =
    view === "week"
      ? fmt.today >= period.from && fmt.today <= period.to
        ? "Due this week"
        : `Due ${new Intl.DateTimeFormat(fmt.locale, { month: "short", day: "numeric", timeZone: "UTC" }).formatRange(utc(period.from), utc(period.to))}`
      : `Due in ${new Intl.DateTimeFormat(fmt.locale, { month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(utc(period.from))}`;

  return (
    <BillActionsProvider data={occurrences} bills={bills} options={options} initialCreate={openNew} onCreateClosed={() => openNew && navigate({ new: null }, { replace: true })}>
      <PageHeader title="Bills" description="Due dates, what's paid and what's still to come. Marking a bill paid only updates your records." actions={bills.length ? <AddBillButton /> : undefined} />
      {bills.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Add your first bill"
            description="Track rent, utilities, phone and insurance. Harbour shows them on a calendar, reminds you before they're due and counts them in your cash-flow estimate."
            action={<AddBillButton />}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <NeededBeforePayday data={beforePayday} className="col-span-2 lg:col-span-1" />
            <PeriodTotals title={periodTitle} occurrences={periodOccurrences} />
            <MonthlyTotal {...recurring} />
          </div>
          <OverdueBills occurrences={beforePayday.overdue} />
          <BillCalendar view={view} date={date} weekStartsOn={weekStartsOn} occurrences={occurrences} />
          <BillsTable bills={bills} />
        </div>
      )}
    </BillActionsProvider>
  );
}
