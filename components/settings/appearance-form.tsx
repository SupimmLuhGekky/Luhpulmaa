"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_OPTIONS } from "@/lib/settings/options";
import { cn } from "@/lib/utils";
import { updatePreferencesAction } from "@/app/actions/settings";

type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];

// Fixed colours: each tile illustrates one theme whatever theme is active.
const PALETTES = {
  light: { bg: "#f6f7f9", card: "#ffffff", line: "#e3e7ec", text: "#c9d0d9", primary: "#0f766e" },
  dark: { bg: "#0a0d12", card: "#10151c", line: "#1e2631", text: "#2a3441", primary: "#2dd4bf" },
} as const;

function Preview({ palette }: { palette: (typeof PALETTES)[keyof typeof PALETTES] }) {
  return (
    <div className="flex h-full w-full gap-1.5 p-2" style={{ backgroundColor: palette.bg }}>
      <div className="flex w-1/4 flex-col gap-1 rounded-sm p-1" style={{ backgroundColor: palette.card }}>
        <span className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: palette.primary }} />
        <span className="h-1 w-full rounded-full" style={{ backgroundColor: palette.text }} />
        <span className="h-1 w-2/3 rounded-full" style={{ backgroundColor: palette.text }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex flex-1 flex-col justify-between rounded-sm p-1.5" style={{ backgroundColor: palette.card, boxShadow: `inset 0 0 0 1px ${palette.line}` }}>
          <span className="h-1 w-1/2 rounded-full" style={{ backgroundColor: palette.text }} />
          <span className="h-2 w-2/3 rounded-full" style={{ backgroundColor: palette.primary }} />
        </div>
        <div className="flex h-1/3 gap-1.5">
          <span className="flex-1 rounded-sm" style={{ backgroundColor: palette.card, boxShadow: `inset 0 0 0 1px ${palette.line}` }} />
          <span className="flex-1 rounded-sm" style={{ backgroundColor: palette.card, boxShadow: `inset 0 0 0 1px ${palette.line}` }} />
        </div>
      </div>
    </div>
  );
}

const ICONS: Record<ThemeValue, React.ComponentType<{ className?: string }>> = { light: Sun, dark: Moon, system: Monitor };

/** Light / dark / match the device. Applies immediately on this device and is saved to the account. */
export function AppearanceForm({ saved }: { saved: ThemeValue }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const current = (mounted ? (theme as ThemeValue | undefined) : undefined) ?? saved;
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const choose = async (value: ThemeValue) => {
    if (value === current) return;
    setTheme(value);
    const res = await updatePreferencesAction({ theme: value });
    if (!res.ok) toast.error("Applied on this device, but couldn't save it to your account", { description: res.error.message });
  };

  const move = (delta: number) => {
    const i = THEME_OPTIONS.findIndex((o) => o.value === current);
    const next = THEME_OPTIONS[(i + delta + THEME_OPTIONS.length) % THEME_OPTIONS.length];
    void choose(next.value);
    refs.current[THEME_OPTIONS.indexOf(next)]?.focus();
  };

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-labelledby="theme-title"
        className="grid grid-cols-3 gap-2.5 sm:gap-4"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          }
        }}
      >
        {THEME_OPTIONS.map((o, i) => {
          const checked = current === o.value;
          const Icon = ICONS[o.value];
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => choose(o.value)}
              className="group flex flex-col gap-2 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span
                className={cn(
                  "block aspect-[16/10] w-full overflow-hidden rounded-lg border-2 transition-colors",
                  checked ? "border-primary" : "border-border group-hover:border-foreground/25",
                )}
              >
                {o.value === "system" ? (
                  <span className="relative block h-full w-full">
                    <span className="absolute inset-0" style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}>
                      <Preview palette={PALETTES.light} />
                    </span>
                    <span className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
                      <Preview palette={PALETTES.dark} />
                    </span>
                  </span>
                ) : (
                  <Preview palette={PALETTES[o.value]} />
                )}
              </span>
              <span className={cn("flex items-center gap-1.5 text-[13px] font-medium", checked ? "text-foreground" : "text-muted-foreground")}>
                <Icon className={cn("size-3.5 shrink-0", checked && "text-primary")} />
                <span className="min-w-0">{o.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {current === "system" ? "Follows your device's light or dark setting, switching automatically." : "Applies right away on this device and is saved to your account."}
      </p>
    </div>
  );
}
