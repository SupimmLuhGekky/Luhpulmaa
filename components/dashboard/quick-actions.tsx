"use client";

import Link from "next/link";
import { CalendarDays, FileUp, Landmark, Plus, Target } from "lucide-react";
import { useShell } from "@/components/layout/shell-provider";
import { cn } from "@/lib/utils";

const tile = "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 text-xs font-medium text-foreground shadow-soft transition-colors hover:bg-accent sm:flex-row sm:gap-2 sm:py-2.5 sm:text-[13px] [&_svg]:size-4 [&_svg]:text-primary";

/** The four actions people reach for most, kept one tap away (mobile first). */
export function QuickActions({ className }: { className?: string }) {
  const { openQuickAdd } = useShell();
  return (
    <nav aria-label="Quick actions" className={cn("grid grid-cols-4 gap-2 sm:flex sm:flex-wrap", className)}>
      <button type="button" className={tile} onClick={() => openQuickAdd()}>
        <Plus aria-hidden /> Transaction
      </button>
      <Link href="/goals?new=1" className={tile}>
        <Target aria-hidden /> Goal
      </Link>
      <Link href="/budget?new=1" className={tile}>
        <CalendarDays aria-hidden /> Budget
      </Link>
      <Link href="/accounts/new" className={tile}>
        <Landmark aria-hidden /> Account
      </Link>
      <Link href="/transactions/import" className={cn(tile, "hidden sm:flex")}>
        <FileUp aria-hidden /> Import CSV
      </Link>
    </nav>
  );
}
