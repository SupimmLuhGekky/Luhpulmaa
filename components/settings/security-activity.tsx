import { Download, KeyRound, Landmark, LogIn, LogOut, MailCheck, ShieldAlert, ShieldCheck, Unplug, UserPlus, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-ui";

export interface SecurityEventRow {
  id: string;
  action: string;
  when: string;
  device: string;
  network: string;
  detail: string | null;
}

const LABELS: Record<string, { label: string; icon: LucideIcon; warn?: boolean }> = {
  "auth.sign_up": { label: "Account created", icon: UserPlus },
  "auth.sign_in": { label: "Signed in", icon: LogIn },
  "auth.sign_in_failed": { label: "Failed sign-in attempt", icon: ShieldAlert, warn: true },
  "auth.sign_out": { label: "Signed out", icon: LogOut },
  "auth.password_reset_requested": { label: "Password reset requested", icon: KeyRound },
  "auth.password_reset": { label: "Password reset", icon: KeyRound },
  "auth.password_changed": { label: "Password changed", icon: KeyRound },
  "auth.email_verified": { label: "Email verified", icon: MailCheck },
  "auth.session_revoked": { label: "Signed out another device", icon: ShieldCheck },
  "account.connected": { label: "Bank connected", icon: Landmark },
  "account.disconnected": { label: "Bank disconnected", icon: Unplug },
  "data.exported": { label: "Data exported", icon: Download },
};

/** Recent sign-ins and other sensitive events from the audit log (coarse device/network only). */
export function SecurityActivity({ events }: { events: SecurityEventRow[] }) {
  return (
    <SettingsSection id="activity" title="Recent security activity" description="If something here wasn't you, change your password and sign out other devices.">
      {events.length === 0 ? (
        <EmptyState compact icon={ShieldCheck} title="No recent activity" description="Sign-ins, password changes and exports will appear here." />
      ) : (
        <ol className="space-y-0.5">
          {events.map((e) => {
            const info = LABELS[e.action] ?? { label: e.action, icon: ShieldCheck };
            const Icon = info.icon;
            return (
              <li key={e.id} className="flex items-start gap-3 rounded-lg px-1 py-2">
                <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md", info.warn ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")}>
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground">
                    {info.label}
                    {e.detail ? <span className="font-normal text-muted-foreground"> · {e.detail}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.device} · {e.network}
                  </p>
                  {/* Phones: the time goes under the details instead of squeezing them into a column. */}
                  <time className="block text-xs text-muted-foreground tabular sm:hidden">{e.when}</time>
                </div>
                <time className="hidden shrink-0 pt-0.5 text-right text-xs text-muted-foreground tabular sm:block">{e.when}</time>
              </li>
            );
          })}
        </ol>
      )}
    </SettingsSection>
  );
}
