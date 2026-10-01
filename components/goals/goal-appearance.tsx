"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { iconFor } from "@/components/shared/category-icon";
import { cn } from "@/lib/utils";

/** Icons from the shared category set that suit savings goals (stored by name). */
export const GOAL_ICONS: { name: string; label: string }[] = [
  { name: "piggy-bank", label: "Piggy bank" },
  { name: "shield", label: "Safety net" },
  { name: "home", label: "Home" },
  { name: "car", label: "Car" },
  { name: "plane", label: "Travel" },
  { name: "graduation-cap", label: "Education" },
  { name: "gift", label: "Gift" },
  { name: "smartphone", label: "Tech" },
  { name: "heart-pulse", label: "Health" },
  { name: "baby", label: "Family" },
  { name: "dog", label: "Pet" },
  { name: "briefcase", label: "Work" },
  { name: "landmark", label: "Investing" },
  { name: "sparkles", label: "Treat" },
  { name: "music", label: "Music" },
  { name: "wrench", label: "Repairs" },
];

export const GOAL_COLORS: { value: string; label: string }[] = [
  { value: "#0ea5e9", label: "Sky" },
  { value: "#10b981", label: "Green" },
  { value: "#14b8a6", label: "Teal" },
  { value: "#6366f1", label: "Indigo" },
  { value: "#8b5cf6", label: "Violet" },
  { value: "#ec4899", label: "Pink" },
  { value: "#ef4444", label: "Red" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#84cc16", label: "Lime" },
  { value: "#64748b", label: "Slate" },
];

/** Radio-group keyboard handling shared by both pickers (arrows move and select). */
function useRovingRadio(count: number, index: number, select: (i: number) => void) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (Math.max(0, index) + delta + count) % count;
    select(next);
    refs.current[next]?.focus();
  };
  return { refs, onKeyDown };
}

export function IconPicker({ value, onChange, color, id }: { value: string; onChange: (icon: string) => void; color: string; id?: string }) {
  const index = GOAL_ICONS.findIndex((i) => i.name === value);
  const { refs, onKeyDown } = useRovingRadio(GOAL_ICONS.length, index, (i) => onChange(GOAL_ICONS[i].name));
  return (
    <div id={id} role="radiogroup" aria-label="Icon" className="grid grid-cols-8 gap-1.5" onKeyDown={onKeyDown}>
      {GOAL_ICONS.map((icon, i) => {
        const Icon = iconFor(icon.name);
        const on = icon.name === value;
        return (
          <button
            key={icon.name}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={icon.label}
            title={icon.label}
            tabIndex={on || (index < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(icon.name)}
            className={cn(
              "flex aspect-square items-center justify-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-4",
              on ? "border-transparent" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            style={on ? { backgroundColor: `${color}1f`, color, boxShadow: `inset 0 0 0 1.5px ${color}` } : undefined}
          >
            <Icon aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export function ColorPicker({ value, onChange, id }: { value: string; onChange: (color: string) => void; id?: string }) {
  const index = GOAL_COLORS.findIndex((c) => c.value.toLowerCase() === value.toLowerCase());
  const { refs, onKeyDown } = useRovingRadio(GOAL_COLORS.length, index, (i) => onChange(GOAL_COLORS[i].value));
  return (
    <div id={id} role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2" onKeyDown={onKeyDown}>
      {GOAL_COLORS.map((c, i) => {
        const on = i === index;
        return (
          <button
            key={c.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c.label}
            title={c.label}
            tabIndex={on || (index < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(c.value)}
            className="flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-card transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            style={{ backgroundColor: c.value, boxShadow: on ? `0 0 0 2px var(--card), 0 0 0 4px ${c.value}` : undefined }}
          >
            {on ? <Check className="size-4 text-white" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
