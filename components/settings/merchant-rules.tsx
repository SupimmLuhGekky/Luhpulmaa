"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Search, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CategoryIcon } from "@/components/shared/category-icon";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { deleteMerchantRuleAction } from "@/app/actions/settings";

export interface MerchantRuleRow {
  id: string;
  pattern: string;
  source: "USER_CORRECTION" | "USER_DEFINED";
  isActive: boolean;
  correctionCount: number;
  category: { id: string; name: string; color: string; icon: string };
  subcategory: string | null;
}

export function MerchantRules({ rules, learningThreshold }: { rules: MerchantRuleRow[]; learningThreshold: number }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [removing, setRemoving] = React.useState<MerchantRuleRow | null>(null);
  const q = query.trim().toLowerCase();
  const shown = q ? rules.filter((r) => r.pattern.toLowerCase().includes(q) || r.category.name.toLowerCase().includes(q)) : rules;

  if (!rules.length) {
    return (
      <EmptyState
        compact
        icon={Sparkles}
        title="No merchant rules yet"
        description={`When you change the category of the same merchant ${learningThreshold} times, Harbour learns it and categorises that merchant for you.`}
      />
    );
  }

  return (
    <div className="space-y-3">
      {rules.length > 6 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by merchant or category" aria-label="Filter merchant rules" className="pl-9" />
        </div>
      ) : null}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {shown.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="max-w-full truncate font-medium text-foreground">{r.pattern}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="categorised as" />
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <CategoryIcon icon={r.category.icon} color={r.category.color} size="sm" />
                  <span className="truncate text-foreground">
                    {r.category.name}
                    {r.subcategory ? <span className="text-muted-foreground"> · {r.subcategory}</span> : null}
                  </span>
                </span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {r.source === "USER_DEFINED" ? <Badge variant="info">Your rule</Badge> : <Badge variant="primary">Learned</Badge>}
                {r.isActive ? (
                  <span>{r.source === "USER_CORRECTION" ? `From ${r.correctionCount} corrections` : "Active"}</span>
                ) : (
                  <span>
                    Learning: {r.correctionCount} of {learningThreshold} corrections
                  </span>
                )}
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setRemoving(r)} aria-label={`Delete the rule for ${r.pattern}`}>
              <Trash2 />
            </Button>
          </li>
        ))}
        {shown.length === 0 ? <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">No rules match “{query}”.</li> : null}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this rule?"
        description={removing ? `New transactions from “${removing.pattern}” won't be put in ${removing.category.name} automatically anymore. Existing transactions keep their category.` : undefined}
        confirmLabel="Delete rule"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          const res = await deleteMerchantRuleAction({ id: removing.id });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success("Rule deleted");
          setRemoving(null);
          router.refresh();
        }}
      />
    </div>
  );
}
