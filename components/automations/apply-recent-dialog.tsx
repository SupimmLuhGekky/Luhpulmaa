"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/shared/field";
import { Segmented } from "@/components/ui/segmented";
import { applyAutomationToRecentAction } from "@/app/actions/automations";

type Days = "7" | "30" | "90";

/**
 * "Run on past transactions": applies one transaction automation to matching transactions
 * from the last 7/30/90 days. Transactions it already handled are skipped.
 */
export function ApplyRecentDialog({
  automation,
  open,
  onOpenChange,
  onApplied,
}: {
  automation: { id: string; name: string; isActive: boolean; plansMoney: boolean } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}) {
  const router = useRouter();
  const [days, setDays] = React.useState<Days>("30");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setDays("30");
      setError(null);
    }
  }, [open]);

  const apply = async () => {
    if (!automation) return;
    setPending(true);
    setError(null);
    const res = await applyAutomationToRecentAction({ id: automation.id, days: Number(days) as 7 | 30 | 90 });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    const { applied, scanned } = res.data;
    toast.success(applied ? `Applied to ${applied} ${applied === 1 ? "transaction" : "transactions"}` : "Nothing new to change", {
      description: `Checked ${scanned} ${scanned === 1 ? "transaction" : "transactions"} from the last ${days} days.`,
    });
    onOpenChange(false);
    onApplied?.();
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Run on past transactions</DialogTitle>
          <DialogDescription>
            Applies “{automation?.name}” to matching transactions you already have. Ones it handled before are skipped, so nothing is done twice.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <FormError message={error} />
          <div className="flex flex-col gap-2">
            <p id="apply-days-label" className="text-[13px] font-medium text-foreground">
              Transactions from the last
            </p>
            <Segmented<Days>
              aria-label="Transactions from the last"
              value={days}
              onChange={setDays}
              className="w-full [&>button]:flex-1"
              options={[
                { value: "7", label: "7 days" },
                { value: "30", label: "30 days" },
                { value: "90", label: "90 days" },
              ]}
            />
          </div>
          {automation?.plansMoney ? (
            <p className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted-foreground">Goal amounts are recorded as planned allocations. No money is moved.</p>
          ) : null}
          {automation && !automation.isActive ? <p className="text-xs font-medium text-warning">Turn this automation on first.</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={apply} loading={pending} disabled={!automation?.isActive}>
            Run now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
