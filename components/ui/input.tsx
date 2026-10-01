import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "flex h-9 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1 text-base text-foreground sm:text-sm shadow-soft transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type = "text", ...props }, ref) => (
  <input type={type} className={cn(inputClass, "file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium", className)} ref={ref} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea className={cn(inputClass, "h-auto min-h-20 py-2", className)} ref={ref} {...props} />
));
Textarea.displayName = "Textarea";
