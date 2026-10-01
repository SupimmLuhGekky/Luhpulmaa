import Link from "next/link";
import { ChevronRight, FileUp, Landmark, PencilLine } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const steps = [
  {
    href: "/transactions/import",
    icon: FileUp,
    title: "Import a CSV from your bank",
    body: "Download your transactions from Neo Financial (or any Canadian bank) and drop the file in. Nothing is shared with Harbour except the file you choose.",
    badge: "Recommended",
  },
  {
    href: "/accounts/new?method=manual",
    icon: PencilLine,
    title: "Add an account by hand",
    body: "Track cash, a chequing account or a loan by entering the balance yourself.",
  },
  {
    href: "/accounts/new",
    icon: Landmark,
    title: "Connect a bank",
    body: "Link an institution through a secure provider when one is set up. Harbour never sees or stores your bank password.",
  },
] as const;

/** First-run panel shown until the user has at least one account. */
export function GetStarted() {
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Bring in your money</h2>
      <p className="mt-1 text-sm text-muted-foreground">Harbour fills in your dashboard once it knows about an account. Pick whichever is easiest.</p>
      <ul className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="group flex h-full gap-3 rounded-xl border border-border bg-subtle p-4 transition-colors hover:border-ring/50 hover:bg-accent">
              <s.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {s.title}
                  {"badge" in s ? <Badge variant="primary">{s.badge}</Badge> : null}
                </span>
                <span className="mt-1 block text-[13px] text-muted-foreground">{s.body}</span>
              </span>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
