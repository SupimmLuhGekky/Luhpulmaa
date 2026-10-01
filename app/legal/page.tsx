import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { COMPLIANCE_NOTICE } from "@/lib/banking-core";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";

export const metadata: Metadata = {
  title: "Terms and privacy",
  description: "How Harbour works, what it does with your information, and what it is not.",
};

const UPDATED = "October 1, 2026";

const SECTIONS = [
  { id: "not-a-bank", title: "Harbour is not a bank" },
  { id: "terms", title: "Terms of use" },
  { id: "privacy", title: "Privacy" },
  { id: "rights", title: "Your choices and rights" },
  { id: "security", title: "Security" },
  { id: "contact", title: "Questions" },
] as const;

export default function LegalPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <Button variant="ghost" asChild>
          <Link href="/">
            <ArrowLeft /> Back to Harbour
          </Link>
        </Button>
      </header>

      <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Terms and privacy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {UPDATED}</p>

        <p className="mt-6 rounded-xl border border-border bg-subtle px-4 py-3 text-[15px] font-medium">{COMPLIANCE_NOTICE}</p>

        <nav aria-label="On this page" className="mt-8">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-primary underline-offset-4 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-10 space-y-12 text-[15px] leading-relaxed text-muted-foreground [&_h2]:scroll-mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:pl-1 [&_p]:mt-3 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
          <section aria-labelledby="not-a-bank">
            <h2 id="not-a-bank">Harbour is not a bank</h2>
            <p>
              Harbour is a tool for organising and planning your money. It does not hold deposits, open bank accounts, issue cards, lend money, or move money between accounts. Your money stays with your bank or other financial
              institution, and their terms continue to apply to it.
            </p>
            <p>
              When Harbour talks about putting money towards a goal, it means a plan you made or a transfer you made yourself at your bank. Harbour never makes a payment or transfer on your behalf, and nothing in Harbour should be
              read as saying that one happened unless your bank data shows it.
            </p>
          </section>

          <section aria-labelledby="terms">
            <h2 id="terms">Terms of use</h2>
            <p>By creating an account or using Harbour, you agree to these terms. If you do not agree, please do not use it.</p>
            <h3>Information, not advice</h3>
            <p>
              Budgets, &ldquo;safe to spend&rdquo;, forecasts, insights and the optional assistant are estimates calculated from the information you provide or connect. They can be incomplete or wrong, for example when a transaction
              is missing, late, or categorised differently than you would. Harbour does not give financial, investment, tax or legal advice. Check important numbers with your financial institution before you rely on them.
            </p>
            <h3>Your account</h3>
            <ul>
              <li>Give accurate information and keep your password to yourself. You are responsible for activity in your account.</li>
              <li>Only add or import financial information that you are allowed to use.</li>
              <li>Do not try to access other people&apos;s data, disrupt the service, or get around its security or limits.</li>
            </ul>
            <h3>Connections and imports</h3>
            <p>
              If you connect a financial institution, you sign in inside the data provider&apos;s own window (for example Flinks or Plaid) or in your own Lunch Flow account, under that provider&apos;s terms and privacy policy. Harbour receives read-only account
              information, never your bank password. You can disconnect at any time. Imported CSV files are read only to create the transactions you confirm.
            </p>
            <h3>The service</h3>
            <p>
              Harbour is provided &ldquo;as is&rdquo;. Features may change, and the service may be unavailable at times. To the extent the law allows, the operator of this Harbour installation is not liable for losses that come from
              relying on estimates, from information that a bank or data provider supplied late or incorrectly, or from interruptions. Nothing in these terms limits rights you have under the consumer protection laws of Quebec or of
              your province.
            </p>
            <p>You can stop using Harbour and delete your account at any time. If these terms change in a meaningful way, you will be told in the app before the change applies to you.</p>
          </section>

          <section aria-labelledby="privacy">
            <h2 id="privacy">Privacy</h2>
            <p>Harbour collects only what it needs to work, uses it only to provide Harbour to you, and does not sell it or use it for advertising.</p>
            <h3>What Harbour stores</h3>
            <ul>
              <li>
                <strong>Your profile:</strong> name, email address, a one-way hash of your password, and preferences such as currency, language, time zone and province.
              </li>
              <li>
                <strong>Your financial information:</strong> the accounts, balances, transactions, budgets, goals, income, bills, subscriptions, rules, notes and tags that you add, import or connect.
              </li>
              <li>
                <strong>Connection tokens:</strong> when you connect a bank, the access token the data provider issues, or the Lunch Flow API key you paste. It is encrypted before it is stored.
              </li>
              <li>
                <strong>Security records:</strong> sign-in activity, the devices you are signed in on, and approximate network information, used to protect your account and shown to you in Settings.
              </li>
            </ul>
            <p>Harbour never asks for or stores bank passwords, security answers, one-time codes, full card numbers or your social insurance number.</p>
            <h3>Who else sees it</h3>
            <ul>
              <li>The data provider you choose to connect, which retrieves your account information for Harbour.</li>
              <li>The email service used to send verification, password and reminder emails, which sees your email address and the message.</li>
              <li>
                If you turn on the optional AI features, the AI provider receives the transactions or summaries needed to answer, for that request only. These features are off unless you turn them on in Settings.
              </li>
              <li>The company hosting this Harbour installation, which stores the database. In the Mac desktop app, your data stays in a database on your own Mac.</li>
            </ul>
            <p>Your information may be disclosed when the law requires it. It is never shared with other Harbour users.</p>
            <h3>Cookies</h3>
            <p>Harbour uses one essential cookie to keep you signed in, and your browser remembers your light or dark theme. There are no advertising or tracking cookies.</p>
            <h3>How long it is kept</h3>
            <p>
              Your information is kept while your account exists. When you delete your account, your profile and financial information are deleted from Harbour&apos;s database. Backups kept by the host may hold copies for a limited
              time before they are overwritten.
            </p>
          </section>

          <section aria-labelledby="rights">
            <h2 id="rights">Your choices and rights</h2>
            <p>Under Quebec&apos;s privacy law and Canada&apos;s federal privacy law, you can access and correct your personal information, take a copy of it, and withdraw your consent. In Harbour:</p>
            <ul>
              <li>
                <strong>See and correct:</strong> everything Harbour holds about you is visible in the app and can be edited.
              </li>
              <li>
                <strong>Take a copy:</strong> Settings lets you export your data as CSV files.
              </li>
              <li>
                <strong>Withdraw consent:</strong> disconnect a bank, turn off AI features or notifications, or delete your account from Settings.
              </li>
            </ul>
          </section>

          <section aria-labelledby="security">
            <h2 id="security">Security</h2>
            <ul>
              <li>Passwords are stored only as strong one-way hashes, and repeated wrong attempts lock sign-in for a while.</li>
              <li>You can see the devices signed in to your account and sign any of them out. Changing your password signs out every other device.</li>
              <li>Connection tokens are encrypted, and connections to Harbour are encrypted in transit when it is hosted on the web.</li>
              <li>Every request checks that the data belongs to the signed-in person.</li>
            </ul>
            <p>
              Harbour will never ask you for your bank password, card number or one-time codes by email, message or phone. Never install browser extensions or scripts on your bank&apos;s website to move data into any app, including
              this one.
            </p>
          </section>

          <section aria-labelledby="contact">
            <h2 id="contact">Questions</h2>
            <p>
              For questions about these terms, your information, or a security concern, contact the person or organisation that runs this Harbour installation. If you are not satisfied with the answer about your personal
              information, you can contact the Commission d&apos;accès à l&apos;information du Québec or the Office of the Privacy Commissioner of Canada.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl px-4 py-8 text-xs text-muted-foreground sm:px-6">
          <p>{COMPLIANCE_NOTICE}</p>
        </div>
      </footer>
    </div>
  );
}
