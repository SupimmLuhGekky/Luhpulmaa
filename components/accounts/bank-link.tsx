"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "@/components/shared/notice";
import { isFlinksOrigin, parseFlinksMessage, type FlinksConnectResult } from "@/lib/banking/flinks-connect";
import type { LinkSession } from "@/lib/banking/types";
import { cn } from "@/lib/utils";
import { completeConnectionAction, createLinkSessionAction, reconnectSimulatedAction, syncConnectionAction } from "@/app/actions/accounts";
import { ImportingStatus, LinkSummary, type LinkOutcome } from "./link-summary";
import { LunchFlowDialog } from "./lunch-flow";
import type { ConnectionView } from "./types";

export type { LinkOutcome };

// ─────────────────────────────────────────────────────────────────────────────
// Plaid Link (loaded on demand from Plaid's CDN, which the CSP allows)
// ─────────────────────────────────────────────────────────────────────────────

const PLAID_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

interface PlaidInstitution {
  name?: string;
  institution_id?: string;
}

interface PlaidHandler {
  open: () => void;
  exit: (opts?: { force?: boolean }) => void;
  destroy: () => void;
}

interface PlaidStatic {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: { institution?: PlaidInstitution | null }) => void;
    onExit?: (error: { display_message?: string | null; error_code?: string } | null, metadata: unknown) => void;
  }) => PlaidHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidStatic;
  }
}

let plaidScript: Promise<PlaidStatic> | null = null;

function loadPlaid(): Promise<PlaidStatic> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  plaidScript ??= new Promise<PlaidStatic>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PLAID_SRC;
    script.async = true;
    script.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error("Plaid Link unavailable")));
    script.onerror = () => {
      plaidScript = null;
      script.remove();
      reject(new Error("Plaid Link failed to load"));
    };
    document.head.appendChild(script);
  });
  return plaidScript;
}

// ─────────────────────────────────────────────────────────────────────────────
// Link state machine shared by "Connect a bank" and "Reconnect"
// ─────────────────────────────────────────────────────────────────────────────

export type LinkPhase =
  | { kind: "idle" }
  | { kind: "starting"; connectionId: string | null }
  | { kind: "widget"; session: LinkSession; connectionId: string | null }
  /** Reconnecting a Lunch Flow connection: the person pastes a new key (LunchFlowDialog). */
  | { kind: "lunchflow"; connectionId: string; institution: string }
  | { kind: "importing"; institution: string | null; reconnect: boolean }
  | { kind: "done"; outcome: LinkOutcome }
  | { kind: "error"; message: string };

export type ReconnectTarget = Pick<ConnectionView, "id" | "provider" | "status" | "institution" | "accountCount">;

interface ConnectResult {
  institution: string;
  accounts: number;
  sync: { status: string; added: number; message?: string };
}

const FAILED_IMPORT = "The first import didn't finish.";

function outcomeOf(r: ConnectResult, reconnected: boolean): LinkOutcome {
  return { institution: r.institution, accounts: r.accounts, added: r.sync.added, warning: r.sync.status === "FAILED" ? (r.sync.message ?? FAILED_IMPORT) : null, reconnected };
}

/**
 * Drives one bank link: simulated banks complete immediately; Flinks opens its hosted
 * iframe (see FlinksConnectDialog); Plaid opens Plaid Link. Credentials are only ever
 * typed into the provider's window; this app receives a one-time token.
 */
export function useBankLink() {
  const router = useRouter();
  const [phase, setPhase] = React.useState<LinkPhase>({ kind: "idle" });
  const target = React.useRef<ReconnectTarget | null>(null);
  const plaid = React.useRef<PlaidHandler | null>(null);

  React.useEffect(() => () => plaid.current?.destroy(), []);

  const settle = React.useCallback(
    (res: { ok: true; data: ConnectResult } | { ok: false; error: { message: string } }) => {
      if (!res.ok) {
        setPhase({ kind: "error", message: res.error.message });
        return;
      }
      setPhase({ kind: "done", outcome: outcomeOf(res.data, Boolean(target.current)) });
      router.refresh();
    },
    [router],
  );

  /** Finishes a link with the provider's one-time token. */
  const complete = React.useCallback(
    async (publicToken: string, metadata: { institution?: string | PlaidInstitution | null } | undefined, institution: string | null) => {
      setPhase({ kind: "importing", institution, reconnect: Boolean(target.current) });
      settle(await completeConnectionAction({ publicToken, metadata }));
    },
    [settle],
  );

  /** Demo mode: link one of the simulated institutions. */
  const connectSimulated = React.useCallback(
    (institutionId: string, name: string) => {
      target.current = null;
      return complete(`mock-public:${institutionId}`, undefined, name);
    },
    [complete],
  );

  const openPlaid = React.useCallback(
    async (session: LinkSession, connectionId: string | null) => {
      let Plaid: PlaidStatic;
      try {
        Plaid = await loadPlaid();
      } catch {
        setPhase({ kind: "error", message: "We couldn't load Plaid's secure window. Check your connection (or any content blocker) and try again." });
        return;
      }
      setPhase({ kind: "widget", session, connectionId });
      plaid.current?.destroy();
      plaid.current = Plaid.create({
        token: session.linkToken!,
        onSuccess: (publicToken, metadata) => {
          const t = target.current;
          if (t && t.status !== "DISCONNECTED") {
            // Update mode: the existing access token works again, so refresh instead of re-exchanging.
            setPhase({ kind: "importing", institution: t.institution, reconnect: true });
            void syncConnectionAction({ connectionId: t.id }).then((res) =>
              settle(res.ok ? { ok: true, data: { institution: t.institution, accounts: t.accountCount, sync: res.data } } : res),
            );
            return;
          }
          const inst = metadata?.institution ?? null;
          void complete(publicToken, { institution: inst ? { name: inst.name, institution_id: inst.institution_id } : null }, inst?.name ?? null);
        },
        onExit: (error) => {
          if (error) setPhase({ kind: "error", message: error.display_message || "The bank connection didn't finish. You can try again." });
          else setPhase({ kind: "idle" });
        },
      });
      plaid.current.open();
    },
    [complete, settle],
  );

  /** Starts a new link, or re-links `reconnect`. */
  const start = React.useCallback(
    async (reconnect?: ReconnectTarget) => {
      target.current = reconnect ?? null;
      if (reconnect?.provider === "LUNCHFLOW") {
        setPhase({ kind: "lunchflow", connectionId: reconnect.id, institution: reconnect.institution });
        return;
      }
      if (reconnect?.provider === "MOCK") {
        setPhase({ kind: "importing", institution: reconnect.institution, reconnect: true });
        settle(await reconnectSimulatedAction({ connectionId: reconnect.id }));
        return;
      }
      setPhase({ kind: "starting", connectionId: reconnect?.id ?? null });
      const res = await createLinkSessionAction(reconnect ? { reconnectConnectionId: reconnect.id } : {});
      if (!res.ok) {
        setPhase({ kind: "error", message: res.error.message });
        return;
      }
      const session = res.data;
      if (session.mode === "iframe" && session.url) setPhase({ kind: "widget", session, connectionId: reconnect?.id ?? null });
      else if (session.mode === "plaid_link" && session.linkToken) await openPlaid(session, reconnect?.id ?? null);
      else setPhase({ kind: "error", message: "This bank can't be connected from here. Import a CSV file or add the account by hand instead." });
    },
    [openPlaid, settle],
  );

  const onFlinksLogin = React.useCallback((r: FlinksConnectResult) => void complete(r.loginId, { institution: r.institution }, r.institution), [complete]);

  const reset = React.useCallback(() => {
    plaid.current?.exit({ force: true });
    target.current = null;
    setPhase({ kind: "idle" });
  }, []);

  const busyWith = phase.kind === "starting" || phase.kind === "widget" || phase.kind === "lunchflow" ? phase.connectionId : undefined;
  return { phase, start, connectSimulated, onFlinksLogin, reset, busy: phase.kind === "starting" || phase.kind === "widget" || phase.kind === "lunchflow" || phase.kind === "importing", busyWith };
}

export type BankLink = ReturnType<typeof useBankLink>;

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────

/** Flinks Connect in an iframe. Only messages from the Flinks origin we opened are trusted. */
export function FlinksConnectDialog({ link }: { link: BankLink }) {
  const { phase, onFlinksLogin, reset } = link;
  const url = phase.kind === "widget" && phase.session.mode === "iframe" ? (phase.session.url ?? null) : null;
  const [loaded, setLoaded] = React.useState(false);
  const handled = React.useRef(false);

  React.useEffect(() => {
    if (!url) return;
    handled.current = false;
    setLoaded(false);
    const onMessage = (event: MessageEvent) => {
      if (handled.current || !isFlinksOrigin(event.origin, url)) return;
      const result = parseFlinksMessage(event.data);
      if (!result) return;
      handled.current = true;
      onFlinksLogin(result);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [url, onFlinksLogin]);

  return (
    <Dialog open={Boolean(url)} onOpenChange={(open) => (!open ? reset() : undefined)}>
      <DialogContent size="lg" aria-describedby="flinks-desc">
        <DialogHeader>
          <DialogTitle>Connect your bank</DialogTitle>
          <DialogDescription id="flinks-desc" className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-positive" aria-hidden />
            You sign in inside Flinks&apos; secure window. Harbour never sees or stores your bank username or password.
          </DialogDescription>
        </DialogHeader>
        <div className="relative h-[68dvh] min-h-0 border-t border-border sm:h-[620px]">
          {!loaded ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Opening secure sign-in…
            </div>
          ) : null}
          {url ? (
            <iframe
              src={url}
              title="Flinks Connect: sign in to your bank"
              className={cn("relative h-full w-full bg-transparent", !loaded && "opacity-0")}
              onLoad={() => setLoaded(true)}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Inline progress, error and summary for a link started on the page itself. */
export function LinkStatus({ link, doneActions }: { link: BankLink; doneActions?: React.ReactNode }) {
  const { phase, reset } = link;
  return (
    <div aria-live="polite">
      {phase.kind === "importing" ? <ImportingStatus institution={phase.institution} /> : null}
      {phase.kind === "error" ? (
        <Notice
          tone="danger"
          title="The bank connection didn't go through"
          action={
            <Button size="sm" variant="outline" onClick={reset}>
              Dismiss
            </Button>
          }
        >
          {phase.message}
        </Notice>
      ) : null}
      {phase.kind === "done" ? <LinkSummary outcome={phase.outcome} actions={doneActions} /> : null}
    </div>
  );
}

/**
 * Dialogs for reconnecting from a list or detail page: the Flinks window or Lunch Flow's
 * key dialog, then a progress → result dialog. (Plaid draws its own overlay.)
 */
export function BankLinkDialogs({ link }: { link: BankLink }) {
  const { phase, reset } = link;
  const open = phase.kind === "importing" || phase.kind === "done" || phase.kind === "error";
  const importing = phase.kind === "importing";
  return (
    <>
      <FlinksConnectDialog link={link} />
      <LunchFlowDialog open={phase.kind === "lunchflow"} reconnect={phase.kind === "lunchflow" ? phase.institution : null} onOpenChange={(o) => (!o ? reset() : undefined)} />
      <Dialog open={open} onOpenChange={(o) => (!o && !importing ? reset() : undefined)}>
        <DialogContent size="sm" hideClose={importing} aria-describedby={undefined} onEscapeKeyDown={(e) => importing && e.preventDefault()} onInteractOutside={(e) => importing && e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{phase.kind === "error" ? "Couldn't reconnect" : phase.kind === "done" ? "All set" : "Reconnecting…"}</DialogTitle>
          </DialogHeader>
          <DialogBody className="pb-4" aria-live="polite">
            {phase.kind === "importing" ? <ImportingStatus institution={phase.institution} /> : null}
            {phase.kind === "error" ? <Notice tone="danger">{phase.message}</Notice> : null}
            {phase.kind === "done" ? <LinkSummary outcome={phase.outcome} /> : null}
          </DialogBody>
          {!importing ? (
            <DialogFooter>
              <Button onClick={reset}>{phase.kind === "error" ? "Close" : "Done"}</Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
