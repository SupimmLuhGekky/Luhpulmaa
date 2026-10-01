"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calculator, Eye, Info, Send, Sparkles, type LucideIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Notice } from "@/components/shared/notice";
import { setAssistantOptInAction } from "@/app/actions/assistant";

const POINTS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Eye, title: "Reads, never acts", text: "It can look at your accounts, transactions, budgets, bills and goals. It can't move money, change anything or contact anyone." },
  { icon: Calculator, title: "Numbers from Harbour", text: "Amounts in answers are calculated by Harbour from your data and shown apart from the AI's explanation." },
  { icon: Send, title: "Sent to Anthropic", text: "Your question and the details it looks up go to Anthropic's Claude API to write the answer. Passwords, bank credentials and tokens never do." },
  { icon: Info, title: "Information, not advice", text: "It explains your own numbers. For investment, tax or legal advice, talk to a qualified professional." },
];

/**
 * What the assistant does and doesn't do, with the opt-in switch. `state` says why the
 * chat isn't shown: the server has it turned off, the person hasn't opted in, or no AI
 * provider is configured.
 */
export function AssistantIntro({ state, optedIn }: { state: "disabled" | "opt-in" | "not-configured"; optedIn: boolean }) {
  return (
    <div className="space-y-4">
      {state === "disabled" ? (
        <Notice tone="neutral" title="The assistant is turned off on this server">
          Whoever runs this Harbour server hasn&apos;t enabled it. Nothing is sent to an AI provider.
        </Notice>
      ) : state === "not-configured" ? (
        <Notice tone="warning" title="The assistant isn't set up yet">
          AI features are on for your account, but this server has no AI provider configured, so questions can&apos;t be answered. Nothing is sent anywhere.
        </Notice>
      ) : null}
      <section className="rounded-xl border border-border bg-card p-5 shadow-soft sm:p-6" aria-labelledby="assistant-intro-title">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary" aria-hidden>
            <Sparkles className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="assistant-intro-title" className="text-base font-semibold text-foreground">
              Ask questions about your money
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              “How much did I spend on restaurants last month?” “Which bills are due before payday?” The assistant looks the answer up in your Harbour data and explains it in plain language.
            </p>
          </div>
        </div>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {POINTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3 rounded-lg bg-subtle/60 p-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">{title}</p>
                <p className="text-[13px] leading-snug text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ul>
        {state === "disabled" ? null : (
          <div className="mt-5 border-t border-border pt-4">
            <OptInSwitch initial={optedIn} />
          </div>
        )}
      </section>
    </div>
  );
}

function OptInSwitch({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);

  const change = async (value: boolean) => {
    setOn(value);
    setSaving(true);
    const res = await setAssistantOptInAction({ optIn: value });
    setSaving(false);
    if (!res.ok) {
      setOn(!value);
      toast.error(res.error.message);
      return;
    }
    toast.success(value ? "AI features turned on" : "AI features turned off");
    router.refresh();
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor="assistant-opt-in" className="text-sm font-medium text-foreground">
          Allow AI features to read my data
        </label>
        <p className="text-[13px] text-muted-foreground">
          Off unless you turn it on. You can turn it off any time here or in{" "}
          <Link href="/settings/privacy#ai" className="font-medium text-foreground underline-offset-4 hover:underline">
            Settings → Data &amp; privacy
          </Link>
          .
        </p>
      </div>
      <Switch id="assistant-opt-in" checked={on} onCheckedChange={change} disabled={saving} className="mt-0.5" />
    </div>
  );
}
