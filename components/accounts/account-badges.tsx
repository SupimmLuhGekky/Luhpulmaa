import { EyeOff, FlaskConical, TriangleAlert, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { connectionState } from "@/lib/accounts/summary";
import type { AccountView } from "./types";

export function isDisconnected(a: Pick<AccountView, "status" | "connection">) {
  return a.status === "DISCONNECTED" || a.connection?.status === "DISCONNECTED";
}

export function needsAttention(a: Pick<AccountView, "status" | "connection">) {
  return !isDisconnected(a) && (a.connection?.status === "REQUIRES_REAUTH" || a.connection?.status === "ERROR");
}

/** Status badges for an account row or header. Renders nothing for a plain, healthy account. */
export function AccountBadges({ account }: { account: Pick<AccountView, "isManual" | "isSimulated" | "isHidden" | "includeInNetWorth" | "status" | "connection"> }) {
  return (
    <>
      {account.isSimulated ? (
        <Badge variant="info" title="Demo data from a simulated bank. Not a real account.">
          <FlaskConical aria-hidden /> Simulated
        </Badge>
      ) : null}
      {account.isManual ? <Badge variant="neutral">Manual</Badge> : null}
      {isDisconnected(account) ? (
        <Badge variant="neutral">
          <Unplug aria-hidden /> Disconnected
        </Badge>
      ) : null}
      {needsAttention(account) ? (
        <Badge variant="warning" title={account.connection?.lastSyncError ?? undefined}>
          <TriangleAlert aria-hidden /> Needs attention
        </Badge>
      ) : null}
      {account.isHidden ? (
        <Badge variant="outline">
          <EyeOff aria-hidden /> Hidden
        </Badge>
      ) : null}
      {!account.includeInNetWorth ? <Badge variant="outline">Not in net worth</Badge> : null}
    </>
  );
}

export function ConnectionStatusBadge({ status }: { status: string }) {
  const state = connectionState(status);
  return <Badge variant={state.tone}>{state.label}</Badge>;
}
