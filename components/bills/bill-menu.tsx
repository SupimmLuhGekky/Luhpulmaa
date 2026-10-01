"use client";

import { MoreHorizontal, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useBillActions } from "./bill-actions";

/** Overflow menu for one bill: edit, pause/resume, delete (confirmed). */
export function BillMenu({ billId, name, isActive = true, className }: { billId: string; name: string; isActive?: boolean; className?: string }) {
  const { editBill, deleteBill, setActive } = useBillActions();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={className} aria-label={`More actions for ${name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => editBill(billId)}>
          <Pencil /> Edit bill
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setActive(billId, !isActive)}>
          {isActive ? <Pause /> : <Play />} {isActive ? "Pause bill" : "Resume bill"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => deleteBill(billId)}>
          <Trash2 /> Delete bill
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
