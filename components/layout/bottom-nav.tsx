"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Drawer, DrawerBody, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { isActive, MOBILE_PRIMARY, NAV_SECTIONS, SETTINGS_ITEM } from "./nav-items";
import type { ShellFlags } from "./sidebar";

export function BottomNav({ flags }: { flags: ShellFlags }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const all = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => !i.flag || flags[i.flag]);
  const primary = MOBILE_PRIMARY.map((href) => all.find((i) => i.href === href)!).filter(Boolean);
  const moreActive = !primary.some((i) => isActive(pathname, i.href));

  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-safe backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
                  <Icon className="size-5" aria-hidden />
                  {item.label === "Dashboard" ? "Home" : item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setOpen(true)} className={cn("flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium", moreActive ? "text-primary" : "text-muted-foreground")} aria-haspopup="dialog">
              <Menu className="size-5" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="text-base font-semibold">Menu</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            {NAV_SECTIONS.map((section, i) => {
              const items = section.items.filter((x) => !x.flag || flags[x.flag]);
              return (
                <div key={i} className={cn(i > 0 && "mt-5")}>
                  {section.label ? <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{section.label}</p> : null}
                  <ul className="grid grid-cols-3 gap-2">
                    {items.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(pathname, item.href);
                      return (
                        <li key={item.href}>
                          <Link href={item.href} className={cn("flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-xs font-medium", active ? "border-primary/40 bg-primary-soft text-primary" : "border-border text-foreground")}>
                            <Icon className="size-5" aria-hidden />
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            <Link href={SETTINGS_ITEM.href} className="mt-5 flex items-center gap-3 rounded-xl border border-border p-3 text-sm font-medium">
              <SETTINGS_ITEM.icon className="size-5" aria-hidden /> Settings
            </Link>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  );
}
