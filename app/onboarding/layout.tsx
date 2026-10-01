import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import { COMPLIANCE_NOTICE } from "@/lib/banking-core";

export const metadata: Metadata = { title: "Set up Harbour" };

/** Setup lives outside the app shell: no navigation, only the steps. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {children}
      <footer className="mx-auto w-full max-w-5xl px-4 pb-8 pt-2 sm:px-6">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {COMPLIANCE_NOTICE}{" "}
          <Link href="/legal" target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-foreground">
            Terms and privacy<span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </p>
      </footer>
    </div>
  );
}
