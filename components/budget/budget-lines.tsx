"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeftRight, Bell, ListPlus, MoreHorizontal, Pencil, PiggyBank, Plus, Repeat, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CategoryIcon } from "@/components/shared/category-icon";
import { EmptyState } from "@/components/shared/empty-state";
import { useFormat } from "@/components/providers/format-provider";
import { formatBps } from "@/lib/finance/money";
import { crossedThreshold } from "@/lib/budget/thresholds";
import type { BudgetLineView } from "@/lib/budget/service";
import { cn } from "@/lib/utils";
import { BudgetMeter } from "./budget-meter";

const GRID = "md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_7.5rem_6.5rem_6.5rem_2.25rem] md:items-center md:gap-4";

export interface BudgetLinesProps {
  lines: BudgetLineView[];
  range: { start: string; end: string };
  defaultThresholds: number[];
  onAdd: () => void;
  onEdit: (line: BudgetLineView) => void;
  onDelete: (line: BudgetLineView) => void;
}

/** Budget lines: a table-like grid on wide screens, stacked cards on phones. */
export function BudgetLines({ lines, range, defaultThresholds, onAdd, onEdit, onDelete }: BudgetLinesProps) {
  if (!lines.length) {
    return (
      <EmptyState
        compact
        icon={ListPlus}
        title="No lines yet"
        description="Add a line for each category you want to plan, or set money aside for savings."
        action={
          <Button onClick={onAdd}>
            <Plus /> Add a line
          </Button>
        }
      />
    );
  }
  return (
    <div>
      <div aria-hidden className={cn("hidden border-b border-border px-5 pb-2 text-xs font-medium text-muted-foreground", GRID)}>
        <span>Category</span>
        <span>Progress</span>
        <span className="text-right">Planned</span>
        <span className="text-right">Actual</span>
        <span className="text-right">Left</span>
        <span />
      </div>
      <ul className="divide-y divide-border">
        {lines.map((line) => (
          <LineRow key={line.id} line={line} range={range} thresholds={line.alertThresholds.length ? line.alertThresholds : defaultThresholds} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </ul>
    </div>
  );
}

function LineRow({ line, range, thresholds, onEdit, onDelete }: { line: BudgetLineView; range: { start: string; end: string }; thresholds: number[]; onEdit: (l: BudgetLineView) => void; onDelete: (l: BudgetLineView) => void }) {
  const fmt = useFormat();
  const tracked = Boolean(line.categoryId);
  const over = tracked && line.remaining < 0;
  const crossed = tracked ? crossedThreshold(line.usedBps, thresholds) : null;
  const usedPercent = Math.floor(line.usedBps / 100);
  const leftText = over ? fmt.money(-line.remaining) : fmt.money(line.remaining);
  const menu = <LineMenu line={line} range={range} onEdit={onEdit} onDelete={onDelete} />;

  const status = over ? (
    <Badge variant="danger">
      <AlertTriangle aria-hidden /> Over budget
    </Badge>
  ) : crossed !== null ? (
    <Badge variant="warning">
      <Bell aria-hidden /> {crossed}% alert reached
    </Badge>
  ) : null;

  return (
    <li className={cn("px-4 py-3.5 sm:px-5", GRID)}>
      <div className="flex min-w-0 items-center gap-3">
        <CategoryIcon icon={line.icon} color={line.color} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onEdit(line)}
            className="block max-w-full truncate rounded text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {line.name}
            <span className="sr-only">, edit line</span>
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {line.amountType === "PERCENT_OF_INCOME" && line.percentBps !== null ? <span>{formatBps(line.percentBps, line.percentBps % 100 ? 2 : 0, fmt.locale)} of income</span> : null}
            {!tracked ? (
              <span className="inline-flex items-center gap-1">
                <PiggyBank className="size-3" aria-hidden /> Set aside
              </span>
            ) : null}
            {line.rolloverEnabled ? (
              <Badge variant="outline">
                <Repeat aria-hidden /> Rollover
              </Badge>
            ) : null}
            {status}
          </div>
        </div>
        <div className="shrink-0 text-right md:hidden">
          {tracked ? (
            <>
              <p className={cn("tabular text-sm font-semibold", over ? "text-danger" : "text-foreground")}>{leftText}</p>
              <p className="text-xs text-muted-foreground">{over ? "over" : "left"}</p>
            </>
          ) : (
            <>
              <p className="tabular text-sm font-semibold">{fmt.money(line.budgeted)}</p>
              <p className="text-xs text-muted-foreground">planned</p>
            </>
          )}
        </div>
        <div className="-mr-2 shrink-0 md:hidden">{menu}</div>
      </div>

      <div className="mt-3 md:mt-0">
        {tracked ? (
          <>
            <BudgetMeter
              usedBps={line.usedBps}
              thresholds={thresholds}
              status={over ? "over" : crossed !== null ? "warning" : "on_track"}
              label={`${line.name} spending`}
              valueText={`${usedPercent}% used: ${fmt.money(line.spent)} of ${fmt.money(line.available)}`}
            />
            <p className="mt-1.5 flex justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular md:hidden">
                {fmt.money(line.spent)} of {fmt.money(line.available)}
              </span>
              <span className="tabular">{usedPercent}% used</span>
              {thresholds.length ? (
                <span className="hidden items-center gap-1 truncate md:inline-flex" title={`Alerts at ${thresholds.map((t) => `${t}%`).join(", ")}`}>
                  <Bell className="size-3 shrink-0" aria-hidden />
                  <span className="sr-only">Alerts at </span>
                  {thresholds.map((t) => `${t}%`).join(" · ")}
                </span>
              ) : null}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Planned to set aside; not matched to spending.</p>
        )}
      </div>

      <div className="hidden text-right md:block">
        <p className="tabular text-sm text-foreground">{fmt.money(line.budgeted)}</p>
        {line.rollover ? <p className="tabular text-xs text-muted-foreground">+{fmt.money(line.rollover)} rollover</p> : null}
      </div>
      <p className="tabular hidden text-right text-sm text-foreground md:block">{tracked ? fmt.money(line.spent) : "—"}</p>
      <div className="hidden text-right md:block">
        {tracked ? (
          <p className={cn("tabular text-sm font-medium", over ? "text-danger" : "text-foreground")}>
            {over ? <span className="sr-only">Over by </span> : null}
            {over ? `−${leftText}` : leftText}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </div>
      <div className="hidden justify-end md:flex">{menu}</div>
    </li>
  );
}

function LineMenu({ line, range, onEdit, onDelete }: { line: BudgetLineView; range: { start: string; end: string }; onEdit: (l: BudgetLineView) => void; onDelete: (l: BudgetLineView) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${line.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => onEdit(line)}>
          <Pencil /> Edit line
        </DropdownMenuItem>
        {line.categoryId ? (
          <DropdownMenuItem asChild>
            <Link href={`/transactions?category=${line.categoryId}&from=${range.start}&to=${range.end}`}>
              <ArrowLeftRight /> View transactions
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => onDelete(line)}>
          <Trash2 /> Delete line
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
