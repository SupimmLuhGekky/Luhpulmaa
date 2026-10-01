"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountType } from "@prisma/client";
import { ExternalLink, KeyRound, Lock, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { useFormat } from "@/components/providers/format-provider";
import type { LinkableAccount, LunchFlowPreview, LunchFlowPreviewAccount } from "@/lib/accounts/lunchflow";
import { suggestLinks } from "@/lib/accounts/lunchflow-match";
import { lunchFlowPreviewSchema, type LunchFlowChoice } from "@/lib/accounts/schemas";
import { isLiability } from "@/lib/accounts/types";
import { connectLunchFlowAction, previewLunchFlowAction } from "@/app/actions/accounts";
import { AccountTypeOptions } from "./account-type-options";
import { ImportingStatus, LinkSummary, type LinkOutcome } from "./link-summary";

export const LUNCH_FLOW_URL = "https://www.lunchflow.app";

/**
 * Connecting Lunch Flow: the person pastes an API key from their Lunch Flow account,
 * then says how each account it shares comes into Harbour. The key stays in this
 * component's memory only while the dialog is open; the server stores it encrypted.
 */

type Step =
  | { kind: "key" }
  | { kind: "choose"; preview: LunchFlowPreview }
  | { kind: "importing"; institution: string | null }
  | { kind: "done"; outcome: LinkOutcome };

/** `mode` is "new", "skip" or "link:<manual account id>". */
interface Choice {
  mode: string;
  type: AccountType;
}

function initialChoices(preview: LunchFlowPreview): Record<string, Choice> {
  const links = suggestLinks(preview.accounts, preview.linkable);
  const out: Record<string, Choice> = {};
  for (const a of preview.accounts) {
    if (a.existing) continue;
    const target = preview.linkable.find((m) => m.id === links[a.providerAccountId]);
    out[a.providerAccountId] =
      a.skipped || !a.supported ? { mode: "skip", type: a.suggestedType } : target ? { mode: `link:${target.id}`, type: target.type } : { mode: "new", type: a.suggestedType };
  }
  return out;
}

function toChoices(choices: Record<string, Choice>): LunchFlowChoice[] {
  return Object.entries(choices).map(([providerAccountId, c]): LunchFlowChoice => {
    if (c.mode === "skip") return { providerAccountId, action: "skip" };
    if (c.mode.startsWith("link:")) return { providerAccountId, action: "link", type: c.type, linkAccountId: c.mode.slice("link:".length) };
    return { providerAccountId, action: "new", type: c.type };
  });
}

export function LunchFlowDialog({ open, onOpenChange, reconnect = null }: { open: boolean; onOpenChange: (open: boolean) => void; reconnect?: string | null }) {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>({ kind: "key" });
  const [apiKey, setApiKey] = React.useState("");
  const [keyError, setKeyError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [choices, setChoices] = React.useState<Record<string, Choice>>({});

  // Every opening starts over, without the key from last time.
  React.useEffect(() => {
    if (!open) return;
    setStep({ kind: "key" });
    setApiKey("");
    setKeyError(null);
    setError(null);
    setChoices({});
  }, [open]);

  const importing = step.kind === "importing";
  const setOpen = (next: boolean) => {
    if (!next && importing) return;
    if (!next) setApiKey("");
    onOpenChange(next);
  };

  const check = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setError(null);
    const parsed = lunchFlowPreviewSchema.safeParse({ apiKey });
    if (!parsed.success) {
      setKeyError(parsed.error.issues[0]?.message ?? "Paste your Lunch Flow API key");
      return;
    }
    setKeyError(null);
    setChecking(true);
    const res = await previewLunchFlowAction({ apiKey: parsed.data.apiKey });
    setChecking(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setChoices(initialChoices(res.data));
    setStep({ kind: "choose", preview: res.data });
  };

  const connect = async (preview: LunchFlowPreview) => {
    setError(null);
    setStep({ kind: "importing", institution: [...new Set(preview.accounts.map((a) => a.institution))].join(", ") });
    const res = await connectLunchFlowAction({ apiKey: apiKey.trim(), accounts: toChoices(choices) });
    if (!res.ok) {
      setError(res.error.message);
      setStep({ kind: "choose", preview });
      return;
    }
    setApiKey("");
    setStep({ kind: "done", outcome: { ...res.data, reconnected: Boolean(reconnect) } });
    router.refresh();
  };

  const heading: Record<Step["kind"], { title: string; description: string }> = {
    key: reconnect
      ? { title: `Reconnect ${reconnect}`, description: "Paste a new API key from Lunch Flow. Your accounts and their history stay as they are." }
      : { title: "Connect Lunch Flow", description: "Lunch Flow connects to your bank. Harbour reads your balances and transactions from Lunch Flow with a key you create there." },
    choose: { title: "Choose what to bring in", description: "Lunch Flow doesn't say what kind of account each one is, so check the type Harbour suggests." },
    importing: { title: "Importing…", description: "Harbour is bringing in your accounts and transactions." },
    done: { title: "All set", description: "Harbour checks for new transactions on its own, and you can choose Sync now any time." },
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        size="lg"
        hideClose={importing}
        aria-describedby="lunchflow-desc"
        onEscapeKeyDown={(e) => importing && e.preventDefault()}
        onInteractOutside={(e) => importing && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{heading[step.kind].title}</DialogTitle>
          <DialogDescription id="lunchflow-desc">{heading[step.kind].description}</DialogDescription>
        </DialogHeader>

        {step.kind === "key" ? (
          <form onSubmit={check} noValidate>
            <DialogBody className="space-y-4">
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-foreground">
                <li>
                  Sign in at{" "}
                  <a href={LUNCH_FLOW_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
                    lunchflow.app <ExternalLink className="size-3.5" aria-hidden />
                    <span className="sr-only">(opens in your browser)</span>
                  </a>{" "}
                  and connect your bank there.
                </li>
                <li>
                  In Lunch Flow, go to <span className="font-medium">Destinations</span>, choose <span className="font-medium">Add Destination</span>, then{" "}
                  <span className="font-medium">API</span>. Copy the API key from the new destination (under <span className="font-medium">Configure</span>).
                </li>
                <li>Paste the key here.</li>
              </ol>
              <Field label="Lunch Flow API key" error={keyError ?? undefined} hint="Harbour stores it encrypted and only uses it to read balances and transactions.">
                <Input
                  type="password"
                  name="lunchflow-api-key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                />
              </Field>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <Lock className="mt-px size-3.5 shrink-0" aria-hidden /> You sign in to your bank inside Lunch Flow. Harbour never sees your bank password.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden /> Lunch Flow&apos;s access to your bank is read-only, and so is this key. Harbour can&apos;t move money.
                </li>
                <li className="flex gap-2">
                  <Unplug className="mt-px size-3.5 shrink-0" aria-hidden /> To stop, disconnect in Harbour and delete the key in Lunch Flow.
                </li>
              </ul>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={checking}>
                Check key
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {step.kind === "choose" ? <ChooseStep preview={step.preview} choices={choices} onChange={setChoices} error={error} reconnect={Boolean(reconnect)} onBack={() => setStep({ kind: "key" })} onConnect={() => void connect(step.preview)} /> : null}

        {step.kind === "importing" ? (
          <DialogBody className="pb-6" aria-live="polite">
            <ImportingStatus institution={step.institution} />
          </DialogBody>
        ) : null}

        {step.kind === "done" ? (
          <>
            <DialogBody className="pb-4" aria-live="polite">
              <LinkSummary outcome={step.outcome} />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" asChild>
                <Link href="/accounts" onClick={() => setOpen(false)}>
                  View accounts
                </Link>
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ChooseStep({
  preview,
  choices,
  onChange,
  error,
  reconnect,
  onBack,
  onConnect,
}: {
  preview: LunchFlowPreview;
  choices: Record<string, Choice>;
  onChange: (next: Record<string, Choice>) => void;
  error: string | null;
  reconnect: boolean;
  onBack: () => void;
  onConnect: () => void;
}) {
  const importing = preview.accounts.filter((a) => a.existing || (choices[a.providerAccountId] && choices[a.providerAccountId]!.mode !== "skip")).length;
  return (
    <>
      <DialogBody className="max-h-[60dvh] space-y-3 overflow-y-auto">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <ul className="space-y-3" aria-label="Accounts in Lunch Flow">
          {preview.accounts.map((a) => {
            const taken = new Set(
              Object.entries(choices)
                .filter(([id, c]) => id !== a.providerAccountId && c.mode.startsWith("link:"))
                .map(([, c]) => c.mode.slice("link:".length)),
            );
            return (
              <AccountChoice
                key={a.providerAccountId}
                account={a}
                choice={choices[a.providerAccountId] ?? null}
                linkable={preview.linkable}
                taken={taken}
                onChange={(c) => onChange({ ...choices, [a.providerAccountId]: c })}
              />
            );
          })}
        </ul>
        {importing === 0 ? <p className="text-xs font-medium text-danger">Choose at least one account to bring in.</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onConnect} disabled={importing === 0}>
          {reconnect ? "Reconnect" : "Connect"}
        </Button>
      </DialogFooter>
    </>
  );
}

function AccountChoice({
  account,
  choice,
  linkable,
  taken,
  onChange,
}: {
  account: LunchFlowPreviewAccount;
  choice: Choice | null;
  linkable: LinkableAccount[];
  taken: Set<string>;
  onChange: (choice: Choice) => void;
}) {
  const f = useFormat();
  const type = account.existing ? account.existing.type : choice && choice.mode !== "skip" ? choice.type : null;
  // Lunch Flow signs balances from the holder's view: a card it shows at -$523 is $523 owed.
  const balance =
    type && isLiability(type)
      ? `Owed ${f.money(-account.balanceCents || 0, { currency: account.currency })}`
      : `Balance ${f.money(account.balanceCents, { currency: account.currency })}`;
  const targets = linkable.filter((m) => m.currency === account.currency);

  const setMode = (mode: string) => {
    if (!choice) return;
    const target = mode.startsWith("link:") ? linkable.find((m) => m.id === mode.slice("link:".length)) : undefined;
    onChange({ mode, type: target ? target.type : choice.mode.startsWith("link:") ? account.suggestedType : choice.type });
  };

  return (
    <li className="rounded-xl border border-border p-3.5">
      <fieldset className="min-w-0">
        <legend className="w-full">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="min-w-0 break-words text-sm font-medium text-foreground">{account.name}</span>
            <span className="text-[13px] tabular-nums text-muted-foreground">{balance}</span>
          </span>
        </legend>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {account.institution} · {account.currency}
        </p>
        {!account.active ? (
          <Notice tone="warning" className="mt-2">
            Lunch Flow says its link to {account.institution} needs attention. Reconnect it in Lunch Flow so new transactions come through.
          </Notice>
        ) : null}
        {account.existing || !choice ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Already in Harbour as <span className="font-medium text-foreground">{account.existing?.name ?? account.name}</span>. It stays connected.
          </p>
        ) : !account.supported ? (
          <p className="mt-2 text-xs text-muted-foreground">Harbour doesn&apos;t support {account.currency} accounts yet, so this one stays out.</p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Bring it in as">
                <Select value={choice.mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="new">A new account</option>
                  {targets.length ? (
                    <optgroup label="Continue an account you already have">
                      {targets.map((m) => (
                        <option key={m.id} value={`link:${m.id}`} disabled={taken.has(m.id)}>
                          {m.name}
                          {m.transactionCount ? ` (${m.transactionCount} transaction${m.transactionCount === 1 ? "" : "s"})` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  <option value="skip">Don&apos;t import</option>
                </Select>
              </Field>
              {choice.mode !== "skip" ? (
                <Field label="Type">
                  <Select value={choice.type} onChange={(e) => onChange({ ...choice, type: e.target.value as AccountType })}>
                    <AccountTypeOptions />
                  </Select>
                </Field>
              ) : null}
            </div>
            {choice.mode.startsWith("link:") ? <p className="mt-2 text-xs text-muted-foreground">It keeps its history, and transactions it already has aren&apos;t imported twice.</p> : null}
          </>
        )}
      </fieldset>
    </li>
  );
}

/** The Lunch Flow option on "Connect a bank". */
export function LunchFlowPanel({ demo }: { demo: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <section aria-labelledby="lunchflow-heading" className="rounded-xl border border-border p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <KeyRound className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="lunchflow-heading" className="text-sm font-semibold">
            Sync through Lunch Flow
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Lunch Flow is a separate, paid service that connects to many Canadian banks. You connect your bank in your own Lunch Flow account, then give Harbour a read-only key so balances and transactions update on their own.
          </p>
          {demo ? (
            <Notice tone="info" className="mt-3">
              The shared demo account can&apos;t connect real accounts. Sign up for your own account to use Lunch Flow.
            </Notice>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={() => setOpen(true)}>
                <KeyRound aria-hidden /> Connect Lunch Flow
              </Button>
              <Button variant="ghost" asChild>
                <a href={LUNCH_FLOW_URL} target="_blank" rel="noopener noreferrer">
                  About Lunch Flow <ExternalLink aria-hidden />
                  <span className="sr-only">(opens in your browser)</span>
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>
      <LunchFlowDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}
