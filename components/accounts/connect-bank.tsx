"use client";

import Link from "next/link";
import { FileUp, FlaskConical, Lock, PencilLine, ShieldCheck, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { InstitutionIcon } from "./account-icon";
import { possessive } from "./format";
import { FlinksConnectDialog, LinkStatus, useBankLink, type BankLink } from "./bank-link";
import type { BankingInfo, ConnectionView, MockInstitution } from "./types";

export interface SimulatedInstitution extends MockInstitution {
  /** This user's existing connection to it, if any. */
  connection: Pick<ConnectionView, "id" | "status" | "accountCount"> | null;
}

export interface ConnectBankProps {
  banking: BankingInfo;
  /** Simulated institutions (demo mode only). */
  institutions: SimulatedInstitution[];
  csvEnabled: boolean;
  onUseCsv: () => void;
  onUseManual: () => void;
}

/** "Connect a bank": the provider's hosted sign-in, or simulated banks in demo mode. */
export function ConnectBank({ banking, institutions, csvEnabled, onUseCsv, onUseManual }: ConnectBankProps) {
  const link = useBankLink();
  const fallback = (
    <div className="flex flex-col gap-2 sm:flex-row">
      {csvEnabled ? (
        <Button variant="outline" onClick={onUseCsv}>
          <FileUp aria-hidden /> Import a CSV file
        </Button>
      ) : null}
      <Button variant="outline" onClick={onUseManual}>
        <PencilLine aria-hidden /> Add an account by hand
      </Button>
    </div>
  );

  if (!banking.enabled || !banking.configured) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Unplug className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{banking.enabled ? "Bank connections aren't set up yet" : "Bank connections are turned off"}</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {banking.enabled
                ? `This server doesn't have its ${banking.displayName} keys configured, so banks can't be connected from here.`
                : "Whoever runs this Harbour server has turned off bank connections."}{" "}
              You can still bring in your accounts: import a CSV file downloaded from your bank, or add an account by hand and update its balance yourself.
            </p>
          </div>
        </div>
        {fallback}
      </div>
    );
  }

  if (banking.simulated) return <SimulatedBanks link={link} institutions={institutions} />;

  const starting = link.phase.kind === "starting" && !link.phase.connectionId;
  const plaid = banking.provider === "PLAID";
  return (
    <div className="space-y-5">
      <ul className="space-y-3">
        <TrustPoint icon={Lock} title={`You sign in inside ${possessive(banking.displayName)} secure window`}>
          Harbour never sees or stores your bank username or password. {banking.displayName} hands Harbour a one-time code instead.
        </TrustPoint>
        <TrustPoint icon={ShieldCheck} title="Read-only">
          Harbour reads balances and transactions to keep your budget up to date. It can&apos;t move money.
        </TrustPoint>
        <TrustPoint icon={Unplug} title="Disconnect anytime">
          From the Accounts page. You choose whether to keep or delete the history already imported.
        </TrustPoint>
      </ul>
      {plaid ? (
        <Notice tone="info" title="Banking with Neo Financial?">
          Neo doesn&apos;t connect through Plaid. Import a CSV export from Neo&apos;s web app instead.
        </Notice>
      ) : null}
      <LinkStatus link={link} doneActions={<DoneActions onReset={link.reset} />} />
      {link.phase.kind !== "done" && link.phase.kind !== "importing" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button onClick={() => void link.start()} loading={starting} disabled={link.busy && !starting}>
            {starting ? "Opening…" : `Continue to ${banking.displayName}`}
          </Button>
          <p className="text-xs text-muted-foreground">
            Opens {possessive(banking.displayName)} sign-in{plaid ? " over this page" : " in a window on this page"}.
          </p>
        </div>
      ) : null}
      <FlinksConnectDialog link={link} />
    </div>
  );
}

function TrustPoint({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

function DoneActions({ onReset }: { onReset: () => void }) {
  return (
    <>
      <Button size="sm" asChild>
        <Link href="/accounts">View accounts</Link>
      </Button>
      <Button size="sm" variant="outline" onClick={onReset}>
        Connect another bank
      </Button>
    </>
  );
}

/** Demo mode: simulated institutions that create realistic sample data. Nothing real is contacted. */
function SimulatedBanks({ link, institutions }: { link: BankLink; institutions: SimulatedInstitution[] }) {
  const { phase } = link;
  const active = phase.kind === "importing" ? phase.institution : null;
  return (
    <div className="space-y-4">
      <Notice tone="info" title="These banks are simulated">
        This server runs in demo mode. Connecting one of these creates sample accounts and transactions so you can try Harbour. No real bank is contacted and none of the data is real.
      </Notice>
      <LinkStatus link={link} doneActions={<DoneActions onReset={link.reset} />} />
      <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Simulated banks">
        {institutions.map((i) => {
          const connected = i.connection && i.connection.status !== "DISCONNECTED";
          const importingThis = active === i.name;
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <InstitutionIcon color={i.color} />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{i.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="info">
                    <FlaskConical aria-hidden /> Simulated
                  </Badge>
                  {connected ? <Badge variant="positive">Connected</Badge> : i.connection ? <Badge variant="neutral">Disconnected</Badge> : null}
                </div>
              </div>
              {connected ? (
                <Button size="sm" variant="ghost" asChild>
                  <Link href="/accounts">View accounts</Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={i.connection ? "outline" : "primary"}
                  className="shrink-0"
                  loading={importingThis}
                  disabled={link.busy && !importingThis}
                  onClick={() => void (i.connection ? link.start({ ...i.connection, provider: "MOCK", institution: i.name }) : link.connectSimulated(i.id, i.name))}
                  aria-label={`${i.connection ? "Reconnect" : "Connect"} ${i.name}`}
                >
                  {i.connection ? "Reconnect" : "Connect"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
