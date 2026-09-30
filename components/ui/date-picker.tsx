"use client";

import * as React from "react";
import { DayPicker } from "react-day-picker";
import { enCA, frCA } from "react-day-picker/locale";
import { CalendarDays, X } from "lucide-react";
import { formatDate, type LocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inputClass } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

function toDate(d: LocalDate): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function toLocal(d: Date): LocalDate {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DatePickerProps {
  value: LocalDate | null | undefined;
  onChange: (value: LocalDate | null) => void;
  locale?: string;
  placeholder?: string;
  clearable?: boolean;
  min?: LocalDate;
  max?: LocalDate;
  id?: string;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/** Calendar popover that stores plain YYYY-MM-DD dates (no time-zone drift). */
export function DatePicker({ value, onChange, locale = "en-CA", placeholder = "Pick a date", clearable, min, max, id, disabled, className, ...aria }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = value ? toDate(value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative w-full min-w-0", className)}>
        <PopoverTrigger asChild>
          <button type="button" id={id} disabled={disabled} className={cn(inputClass, "items-center justify-between gap-2 text-left", !value && "text-muted-foreground/70")} {...aria}>
            <span className="truncate">{value ? formatDate(value, "medium", locale) : placeholder}</span>
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        {clearable && value ? (
          <button type="button" onClick={() => onChange(null)} className="absolute right-8 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear date">
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      <PopoverContent className="w-auto p-2">
        <DayPicker
          mode="single"
          locale={locale.startsWith("fr") ? frCA : enCA}
          selected={selected}
          defaultMonth={selected}
          weekStartsOn={0}
          captionLayout="dropdown"
          startMonth={new Date(2000, 0)}
          endMonth={new Date(new Date().getFullYear() + 10, 11)}
          disabled={[...(min ? [{ before: toDate(min) }] : []), ...(max ? [{ after: toDate(max) }] : [])]}
          onSelect={(d) => {
            if (d) {
              onChange(toLocal(d));
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
