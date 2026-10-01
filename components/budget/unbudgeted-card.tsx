"use client";

import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { CategoryIcon } from "@/components/shared/category-icon";
import { useFormat } from "@/components/providers/format-provider";
import type { BudgetView } from "@/lib/budget/service";

/** Spending in categories that have no line in this budget. */
export function UnbudgetedCard({ items, total, spentInLines, range, onBudget }: {
  items: BudgetView["unbudgeted"];
  total: number;
  /** Spending matched to budget lines, to word the empty state. */
  spentInLines: number;
  range: { start: string; end: string };
  onBudget: (item: BudgetView["unbudgeted"][number]) => void;
}) {
  const fmt = useFormat();
  return (
    <Card>
      <CardHeading
        title="Unbudgeted spending"
        description={items.length ? "Categories you spent in without a line." : spentInLines > 0 ? "Everything you spent is covered by a line." : "Nothing spent outside your lines so far."}
        action={items.length ? <span className="tabular text-sm font-semibold">{fmt.money(total)}</span> : null}
      />
      {items.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {items.map((u) => (
            <li key={u.categoryId ?? "uncategorized"} className="flex items-center gap-3 px-5 py-2.5">
              <CategoryIcon icon={u.icon} color={u.color} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm">{u.name}</span>
              <span className="tabular text-sm">{fmt.money(u.spent)}</span>
              {u.categoryId ? (
                <Button variant="ghost" size="sm" className="-mr-2 shrink-0" onClick={() => onBudget(u)} aria-label={`Add a ${u.name} line`}>
                  <Plus /> Line
                </Button>
              ) : (
                <Button variant="ghost" size="sm" className="-mr-2 shrink-0" asChild>
                  <Link href={`/transactions?categoryId=uncategorized&from=${range.start}&to=${range.end}`} aria-label="Review uncategorized transactions">
                    <Search /> Review
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
