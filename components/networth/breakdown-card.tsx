"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, EyeOff, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useFormat } from "@/components/providers/format-provider";
import { ACCOUNT_TYPE_LABELS } from "@/lib/accounts/types";
import type { NetWorthOverview } from "@/lib/networth/service";
import type { AccountType } from "@prisma/client";
import { cn } from "@/lib/utils";
import { NET_WORTH_COLORS } from "./net-worth-chart";

type Group = NetWorthOverview["accounts"]["groups"][number];
type Account = Group["accounts"][number];

/** "Maple Trust · Chequing" (institution when known, then the account type). */
function accountMeta(a: Account) {
  return [a.institution, ACCOUNT_TYPE_LABELS[a.type as AccountType] ?? null].filter(Boolean).join(" · ");
}

export function AccountBadges({ account }: { account: Pick<Account, "isSimulated" | "isManual" | "isHidden"> }) {
  return (
    <>
      {account.isSimulated ? (
        <Badge variant="info" title="Demo data from a simulated bank. Not a real account.">
          <FlaskConical aria-hidden /> Simulated
        </Badge>
      ) : null}
      {account.isManual ? <Badge variant="neutral">Manual</Badge> : null}
      {account.isHidden ? (
        <Badge variant="outline">
          <EyeOff aria-hidden /> Hidden
        </Badge>
      ) : null}
    </>
  );
}

/**
 * Signed change with an arrow and words for screen readers. For debts the amount is
 * what is owed, so "down" means less debt.
 */
export function ChangeText({ value, className, suffix }: { value: number | null; className?: string; suffix?: string }) {
  const fmt = useFormat();
  if (value === null) return <span className={cn("text-muted-foreground", className)}>No earlier balance</span>;
  if (value === 0) return <span className={cn("text-muted-foreground", className)}>No change{suffix ? ` ${suffix}` : ""}</span>;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-muted-foreground", className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">{value > 0 ? "up " : "down "}</span>
      <span className="tabular font-medium text-foreground">{fmt.money(Math.abs(value))}</span>
      {suffix ? <span>&nbsp;{suffix}</span> : null}
    </span>
  );
}

/**
 * One side of the balance sheet (assets or debts): its total and change, then each
 * group (cash, investments, credit cards, loans…) with its share and accounts.
 * Debt amounts are shown as owed (positive); their changes are changes in what is owed.
 */
export function BreakdownCard({ side, total, change, groups, sinceLabel, className }: {
  side: "asset" | "liability";
  total: number;
  /** Change of the side's total over the range (assets held, or amount owed). */
  change: number | null;
  groups: Group[];
  /** "since Apr 3" */
  sinceLabel: string | null;
  className?: string;
}) {
  const fmt = useFormat();
  const isAsset = side === "asset";
  const title = isAsset ? "Assets" : "Debts";
  const color = isAsset ? NET_WORTH_COLORS.assets : NET_WORTH_COLORS.debts;
  // Account and group changes are effects on net worth; for debts show the change in what is owed.
  const owedOrHeld = (effect: number | null) => (effect === null ? null : isAsset ? effect : -effect);
  const headingId = `nw-${side}`;

  return (
    <Card className={cn("min-w-0 p-5", className)}>
      <section aria-labelledby={headingId}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
              {title}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{isAsset ? "What you own" : "What you owe, subtracted from net worth"}</p>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="tabular text-xl font-semibold tracking-tight text-foreground">{fmt.money(total)}</p>
            {sinceLabel && change !== null ? <ChangeText value={change} suffix={sinceLabel} className="text-xs" /> : null}
          </div>
        </div>

        {groups.length ? (
          <div className="mt-4 space-y-5">
            {groups.map((g) => (
              <section key={g.key} aria-label={`${g.label}: ${fmt.money(g.total)}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[13px] font-semibold text-foreground">{g.label}</h3>
                  <p className="tabular text-[13px] font-medium text-foreground">{fmt.money(g.total)}</p>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(g.total > 0 ? 1.5 : 0, Math.min(100, g.shareBps / 100))}%`, backgroundColor: color }} />
                  </div>
                  <span className="tabular w-24 shrink-0 text-right text-xs text-muted-foreground">
                    {Math.round(g.shareBps / 100)}% of {isAsset ? "assets" : "debts"}
                  </span>
                </div>
                <ul className="mt-2 divide-y divide-border">
                  {g.accounts.map((a) => (
                    <li key={a.id}>
                      <Link href={`/accounts/${a.id}`} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-foreground">{a.name}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="truncate">{accountMeta(a)}</span>
                            <AccountBadges account={a} />
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="tabular block text-sm font-medium text-foreground">
                            <span className="sr-only">{isAsset ? "Balance " : "Owed "}</span>
                            {fmt.money(a.balance)}
                          </span>
                          <span className="block text-xs">
                            {sinceLabel ? <ChangeText value={owedOrHeld(a.change)} /> : null}
                            <span className="sr-only"> {sinceLabel}</span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-muted-foreground">{isAsset ? "No assets included in net worth." : "No debts included in net worth."}</p>
        )}
      </section>
    </Card>
  );
}
