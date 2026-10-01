"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/shared/logo";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isActive, NAV_SECTIONS, SETTINGS_ITEM, type NavItem } from "./nav-items";

export interface ShellFlags {
  assistant: boolean;
  automations: boolean;
}

function visible(items: NavItem[], flags: ShellFlags) {
  return items.filter((i) => !i.flag || flags[i.flag]);
}

function NavLink({ item, active, condensed }: { item: NavItem; active: boolean; condensed: boolean }) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
        condensed ? "size-10 justify-center" : "h-9 px-2.5",
        active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      <span className={cn(condensed && "sr-only")}>{item.label}</span>
    </Link>
  );
  return condensed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

/**
 * Desktop: full sidebar (≥1280px). Tablet (768–1279px): condensed icon rail with
 * tooltips. Phones use the bottom navigation instead.
 */
export function Sidebar({ flags }: { flags: ShellFlags }) {
  const pathname = usePathname();
  return (
    <>
      {[false, true].map((condensed) => (
        <aside
          key={String(condensed)}
          className={cn(
            "fixed inset-y-0 left-0 z-30 flex-col border-r border-border bg-card",
            condensed ? "hidden w-16 items-center md:flex xl:hidden" : "hidden w-60 xl:flex",
          )}
          aria-label="Main navigation"
        >
          <div className={cn("flex h-14 shrink-0 items-center", condensed ? "justify-center" : "px-5")}>
            <Link href="/dashboard" aria-label="Harbour home">
              <Logo withWordmark={!condensed} />
            </Link>
          </div>
          <nav className={cn("flex-1 overflow-y-auto pb-4 scrollbar-none", condensed ? "px-3" : "px-3")}>
            {NAV_SECTIONS.map((section, i) => {
              const items = visible(section.items, flags);
              if (!items.length) return null;
              return (
                <div key={i} className={cn(i > 0 && "mt-5")}>
                  {section.label && !condensed ? <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{section.label}</p> : null}
                  {section.label && condensed ? <div className="mx-auto mb-3 h-px w-6 bg-border" aria-hidden /> : null}
                  <ul className={cn("flex flex-col", condensed ? "items-center gap-1" : "gap-0.5")}>
                    {items.map((item) => (
                      <li key={item.href}>
                        <NavLink item={item} active={isActive(pathname, item.href)} condensed={condensed} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
          <div className={cn("shrink-0 border-t border-border py-3", condensed ? "px-3" : "px-3")}>
            <NavLink item={SETTINGS_ITEM} active={isActive(pathname, SETTINGS_ITEM.href)} condensed={condensed} />
          </div>
        </aside>
      ))}
    </>
  );
}
