"use client";

import type { Frequency } from "@prisma/client";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryIcon } from "@/components/shared/category-icon";
import { useFormat } from "@/components/providers/format-provider";
import { FREQUENCY_LABELS } from "@/lib/dates/schedule";
import { cn } from "@/lib/utils";
import { useBillActions } from "./bill-actions";
import { BillMenu } from "./bill-menu";
import { reminderLabel } from "./status";
import type { BillRow } from "./types";

function BillAmount({ bill, className }: { bill: BillRow; className?: string }) {
  const fmt = useFormat();
  return (
    <span className={cn("tabular whitespace-nowrap", className)}>
      {bill.isVariableAmount ? (
        <>
          <span aria-hidden>≈ </span>
          <span className="sr-only">About </span>
        </>
      ) : null}
      {fmt.money(bill.amountCents)}
    </span>
  );
}

/** Every bill (active and paused) with its schedule, for editing, pausing and deleting. */
export function BillsTable({ bills }: { bills: BillRow[] }) {
  const fmt = useFormat();
  const { addBill } = useBillActions();
  const active = bills.filter((b) => b.isActive).length;
  const paused = bills.length - active;
  const nextDue = (b: BillRow) => (b.nextDueDate ? fmt.date(b.nextDueDate, "medium") : b.isActive ? "No upcoming date" : "Paused");

  return (
    <Card className="min-w-0">
      <CardHeading
        title="Your bills"
        description={`${active} active${paused ? ` · ${paused} paused` : ""}`}
        action={
          <Button size="sm" variant="outline" onClick={addBill}>
            <Plus /> Add bill
          </Button>
        }
      />
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Bill</TableHead>
              <TableHead>Repeats</TableHead>
              <TableHead>Next due</TableHead>
              <TableHead className="hidden lg:table-cell">Paid from</TableHead>
              <TableHead className="hidden lg:table-cell">Reminder</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="max-w-80">
                  <div className="flex min-w-0 items-center gap-3">
                    <CategoryIcon icon={b.category?.icon ?? "receipt"} color={b.category?.color ?? "#64748b"} size="sm" className={cn(!b.isActive && "opacity-60")} />
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-2">
                        <span className={cn("truncate font-medium", b.isActive ? "text-foreground" : "text-muted-foreground")}>{b.name}</span>
                        {!b.isActive ? <Badge>Paused</Badge> : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{[b.category?.name ?? "No category", b.autopay ? "Autopay" : null].filter(Boolean).join(" · ")}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{FREQUENCY_LABELS[b.frequency as Frequency]}</TableCell>
                <TableCell className={cn("whitespace-nowrap", !b.nextDueDate && "text-muted-foreground")}>{nextDue(b)}</TableCell>
                <TableCell className="hidden max-w-44 truncate text-muted-foreground lg:table-cell">{b.account?.name ?? "Not set"}</TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{reminderLabel(b.reminderDaysBefore)}</TableCell>
                <TableCell className="text-right font-medium">
                  <BillAmount bill={b} />
                </TableCell>
                <TableCell className="w-12">
                  <BillMenu billId={b.id} name={b.name} isActive={b.isActive} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y divide-border border-t border-border md:hidden">
        {bills.map((b) => (
          <li key={b.id} className="flex items-center gap-3 py-3 pl-4 pr-2">
            <CategoryIcon icon={b.category?.icon ?? "receipt"} color={b.category?.color ?? "#64748b"} size="sm" className={cn(!b.isActive && "opacity-60")} />
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm font-medium", b.isActive ? "text-foreground" : "text-muted-foreground")}>{b.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[!b.isActive ? "Paused" : null, FREQUENCY_LABELS[b.frequency as Frequency], b.nextDueDate ? `next ${fmt.date(b.nextDueDate, "monthDay")}` : null, b.autopay ? "Autopay" : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <BillAmount bill={b} className={cn("text-sm font-semibold", b.isActive ? "text-foreground" : "text-muted-foreground")} />
            <BillMenu billId={b.id} name={b.name} isActive={b.isActive} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
