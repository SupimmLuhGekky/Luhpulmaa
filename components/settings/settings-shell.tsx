"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SETTINGS_GROUPS, SETTINGS_ITEMS } from "./sections";

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop side navigation for settings. */
function SettingsNav({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Settings">
      <p className="mb-3 px-2.5 text-sm font-semibold tracking-tight text-foreground">
        <Link href="/settings" className="hover:text-primary">
          Settings
        </Link>
      </p>
      {SETTINGS_GROUPS.map((group, i) => (
        <div key={group.label} className={cn(i > 0 && "mt-4")}>
          <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{group.label}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isCurrent(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                      active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Two-column settings layout on large screens (section list + page). On phones the
 * index page is the list and each section page gets a back link.
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isIndex = pathname === "/settings";
  const current = SETTINGS_ITEMS.find((i) => isCurrent(pathname, i.href));
  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8 xl:gap-12">
      <aside className="hidden lg:block">
        <div className="sticky top-20">
          <SettingsNav pathname={pathname} />
        </div>
      </aside>
      <div className="min-w-0">
        {!isIndex ? (
          <Link href="/settings" className="-ml-1 mb-3 inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[13px] font-medium text-muted-foreground hover:text-foreground lg:hidden">
            <ChevronLeft className="size-4" aria-hidden />
            Settings
            {current ? <span className="sr-only">: back from {current.label}</span> : null}
          </Link>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** Grouped list of every settings page (the index on phones, an overview on desktop). */
export function SettingsIndexList({ automationsEnabled }: { automationsEnabled: boolean }) {
  return (
    <div className="space-y-6">
      {SETTINGS_GROUPS.map((group) => (
        <section key={group.label} aria-labelledby={`settings-group-${group.label}`}>
          <h2 id={`settings-group-${group.label}`} className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft lg:grid lg:grid-cols-2 lg:divide-y-0 lg:gap-px lg:bg-border">
            {group.items.map((item) => {
              const Icon = item.icon;
              const off = item.href === "/settings/automations" && !automationsEnabled;
              return (
                <li key={item.href} className="bg-card lg:odd:last:col-span-2">
                  <Link href={item.href} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/60">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{item.label}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">{off ? "Turned off on this server" : item.description}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
