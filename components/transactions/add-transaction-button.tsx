"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/layout/shell-provider";

export function AddTransactionButton({ accountId }: { accountId?: string }) {
  const { openQuickAdd } = useShell();
  return (
    <Button onClick={() => openQuickAdd(accountId ? { accountId } : undefined)}>
      <Plus /> Add transaction
    </Button>
  );
}
