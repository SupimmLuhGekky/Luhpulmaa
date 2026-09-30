import { cn } from "@/lib/utils";

/** Harbour wordmark: a simple anchor-wave glyph. Original artwork. */
export function Logo({ className, withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight text-foreground", className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="9" fill="var(--primary)" />
        <path d="M16 8.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm0 5v10.5" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" fill="none" />
        <path d="M9 18.5c0 3.6 3.1 5.5 7 5.5s7-1.9 7-5.5" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" fill="none" />
        <path d="M12.5 16.5h7" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {withWordmark ? <span className="text-[17px]">Harbour</span> : null}
    </span>
  );
}
