"use client";

import * as React from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import type { SafeToSpend } from "@/lib/forecast/service";
import type { ForecastBase, ForecastHorizon } from "@/lib/forecast/window";
import { BufferCard, BufferDialog } from "./buffer-card";
import { CashFlowForecast } from "./cash-flow-forecast";
import { SafeToSpendCard } from "./safe-to-spend-card";

export interface ForecastViewProps {
  safe: SafeToSpend;
  base: ForecastBase;
  initialDays: ForecastHorizon;
  nextPayday: { date: string; amount: number; label: string } | null;
}

export function ForecastView({ safe, base, initialDays, nextPayday }: ForecastViewProps) {
  const [bufferOpen, setBufferOpen] = React.useState(false);
  const buffer = safe.lines.find((l) => l.key === "minimumBuffer")?.amount ?? base.minimumBuffer;
  const hasCash = safe.details.accounts.length > 0;

  return (
    <>
      <PageHeader title="Cash flow" description="What's safe to spend before payday, and where your cash is heading. Every projection here is an estimate." />
      {!hasCash ? (
        <Card>
          <EmptyState
            icon={Activity}
            title="Add a chequing or cash account"
            description="Safe to spend and the forecast start from the cash in your everyday accounts. Connect your bank or add an account by hand."
            action={
              <Button asChild>
                <Link href="/accounts/new">Add an account</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <SafeToSpendCard data={safe} onEditBuffer={() => setBufferOpen(true)} />
            <BufferCard buffer={buffer} includesSavings={safe.includesSavings} nextPayday={nextPayday} onEditBuffer={() => setBufferOpen(true)} />
          </div>
          <CashFlowForecast base={base} initialDays={initialDays} />
        </div>
      )}
      <BufferDialog open={bufferOpen} onOpenChange={setBufferOpen} current={buffer} />
    </>
  );
}
