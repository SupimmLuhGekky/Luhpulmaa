"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AppWindow, HelpCircle, LogOut, Monitor, Smartphone, Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatRelativeTime } from "@/lib/dates";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/app/actions/settings";
import { SettingsSection } from "./settings-ui";

export interface SessionRow {
  id: string;
  device: string;
  kind: "desktop" | "mobile" | "tablet" | "app" | "unknown";
  network: string;
  createdAt: string;
  createdLabel: string;
  lastUsedAt: string;
  current: boolean;
}

const KIND_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet, app: AppWindow, unknown: HelpCircle } as const;

export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [target, setTarget] = React.useState<SessionRow | "others" | null>(null);
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => setNow(new Date()), []);
  const others = sessions.filter((s) => !s.current).length;

  const confirm = async () => {
    if (!target) return;
    const res = target === "others" ? await revokeOtherSessionsAction({}) : await revokeSessionAction({ id: target.id });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(target === "others" ? `Signed out ${res.data.revoked} other ${res.data.revoked === 1 ? "session" : "sessions"}` : `Signed out ${target.device}`);
    setTarget(null);
    router.refresh();
  };

  return (
    <SettingsSection
      id="sessions"
      title="Where you're signed in"
      description="Devices and browsers with an active session. Locations are approximate and partly hidden."
      action={
        others > 0 ? (
          <Button variant="outline" size="sm" onClick={() => setTarget("others")}>
            <LogOut /> Sign out other devices
          </Button>
        ) : null
      }
    >
      <ul className="divide-y divide-border rounded-lg border border-border">
        {sessions.map((s) => {
          const Icon = KIND_ICON[s.kind];
          return (
            <li key={s.id} className="flex items-center gap-3 px-3.5 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium text-foreground">
                  <span className="truncate">{s.device}</span>
                  {s.current ? <Badge variant="positive">This device</Badge> : null}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span>{s.network}</span>
                  <span aria-hidden> · </span>
                  <span>{s.current ? "Active now" : `Last active ${now ? formatRelativeTime(s.lastUsedAt, now) : "recently"}`}</span>
                  <span className="hidden sm:inline">
                    <span aria-hidden> · </span>Signed in {s.createdLabel}
                  </span>
                </p>
              </div>
              {!s.current ? (
                <Button variant="ghost" size="sm" onClick={() => setTarget(s)} aria-label={`Sign out ${s.device}`}>
                  Sign out
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={target === "others" ? "Sign out every other device?" : "Sign out this device?"}
        description={
          target === "others"
            ? `${others} other ${others === 1 ? "session" : "sessions"} will end. You'll stay signed in here.`
            : target
              ? `${target.device} (${target.network}) will need to sign in again.`
              : undefined
        }
        confirmLabel="Sign out"
        destructive
        onConfirm={confirm}
      />
    </SettingsSection>
  );
}
