import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputClass } from "./input";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options?: SelectOption[];
  placeholder?: string;
  children?: React.ReactNode;
}

/**
 * Styled native <select>: fully keyboard/screen-reader accessible and uses the
 * platform picker on mobile. Pass `options` or <option>/<optgroup> children.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, options, placeholder, children, ...props }, ref) => (
  <div className={cn("relative w-full min-w-0", className)}>
    <select ref={ref} className={cn(inputClass, "appearance-none pr-8")} {...props}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
  </div>
));
Select.displayName = "Select";
