"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { transactionFormOptionsAction, type QuickAddOptions } from "@/app/actions/shell";
import { CommandPalette } from "./command-palette";
import type { ShellFlags } from "./sidebar";

interface ShellContextValue {
  openQuickAdd: (opts?: { accountId?: string }) => void;
  openSearch: () => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

export function useShell() {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside the app shell");
  return ctx;
}

/** Hosts app-wide overlays (quick add, command palette) and exposes openers. */
export function ShellProvider({ flags, children }: { flags: ShellFlags; children: React.ReactNode }) {
  const router = useRouter();
  const [quickAdd, setQuickAdd] = React.useState<{ open: boolean; accountId?: string }>({ open: false });
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [options, setOptions] = React.useState<QuickAddOptions | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const openQuickAdd = React.useCallback((opts?: { accountId?: string }) => {
    setQuickAdd({ open: true, accountId: opts?.accountId });
    setLoadError(null);
    transactionFormOptionsAction({}).then((res) => {
      if (res.ok) setOptions(res.data);
      else setLoadError(res.error.message);
    });
  }, []);
  const openSearch = React.useCallback(() => setSearchOpen(true), []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = React.useMemo(() => ({ openQuickAdd, openSearch }), [openQuickAdd, openSearch]);

  return (
    <ShellContext.Provider value={value}>
      {children}
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} flags={flags} onQuickAdd={() => openQuickAdd()} />
      <Dialog open={quickAdd.open} onOpenChange={(open) => setQuickAdd((s) => ({ ...s, open }))}>
        <DialogContent size="md" aria-describedby="quick-add-desc">
          <DialogHeader>
            <DialogTitle>Add a transaction</DialogTitle>
            <DialogDescription id="quick-add-desc">For cash or anything your bank hasn&apos;t shown yet.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">
            {loadError ? (
              <p className="text-sm text-danger">{loadError}</p>
            ) : options ? (
              <TransactionForm
                key={quickAdd.accountId ?? "any"}
                options={options}
                defaultAccountId={quickAdd.accountId}
                onCancel={() => setQuickAdd({ open: false })}
                onDone={() => {
                  setQuickAdd({ open: false });
                  router.refresh();
                }}
              />
            ) : (
              <div className="space-y-3" aria-busy="true" aria-label="Loading">
                <Skeleton className="h-9 w-full" />
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                </div>
                <Skeleton className="h-9 w-full" />
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </ShellContext.Provider>
  );
}
