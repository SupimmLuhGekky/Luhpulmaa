import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { COMPLIANCE_NOTICE } from "@/lib/banking-core";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-[#0b3b39] p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute -right-32 -top-32 size-[28rem] rounded-full bg-teal-400/10 blur-3xl" />
        <div aria-hidden className="absolute -bottom-40 -left-20 size-[26rem] rounded-full bg-sky-400/10 blur-3xl" />
        <Link href="/" className="relative w-fit [&_span]:text-white">
          <Logo />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Know where every dollar goes — and where it&apos;s going next.</h2>
          <ul className="mt-8 space-y-3 text-[15px] text-white/80">
            <li>Automatic categories that learn from your corrections</li>
            <li>Budgets, savings goals and a safe-to-spend number you can trust</li>
            <li>Bills, subscriptions and cash-flow forecasts in one calendar</li>
          </ul>
        </div>
        <p className="relative max-w-md text-xs leading-relaxed text-white/55">{COMPLIANCE_NOTICE}</p>
      </aside>
      <main id="main" className="flex flex-col px-4 py-8 sm:px-8">
        <Link href="/" className="mb-10 w-fit lg:hidden">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center pb-10">{children}</div>
        <p className="mx-auto max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground lg:hidden">{COMPLIANCE_NOTICE}</p>
      </main>
    </div>
  );
}
