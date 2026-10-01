"use client";

import * as React from "react";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { updateNotificationPreferenceAction } from "@/app/actions/notifications";

export type ChannelKey = "inApp" | "email" | "push" | "sms";
type NotificationType = Parameters<typeof updateNotificationPreferenceAction>[0]["type"];

export interface NotificationPreferenceItem {
  type: NotificationType;
  label: string;
  description: string;
  inAppLocked: boolean;
  inApp: boolean;
  email: boolean;
  push: boolean;
  sms: boolean;
}

export interface ChannelInfo {
  key: ChannelKey;
  label: string;
  available: boolean;
  note?: string;
}

const SHORT: Record<ChannelKey, string> = { inApp: "In app", email: "Email", push: "Push", sms: "Text" };
const PHRASE: Record<ChannelKey, string> = { inApp: "in the app", email: "by email", push: "as push notifications", sms: "by text message" };

/** Per-type channel switches. Each switch saves on its own; unavailable channels are shown but can't be turned on. */
export function NotificationPreferencesMatrix({ items, channels }: { items: NotificationPreferenceItem[]; channels: ChannelInfo[] }) {
  const [rows, setRows] = React.useState(items);
  const [pending, setPending] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => setRows(items), [items]);

  const toggle = async (type: NotificationType, channel: ChannelKey, value: boolean) => {
    const key = `${type}:${channel}`;
    setPending((p) => new Set(p).add(key));
    setRows((list) => list.map((r) => (r.type === type ? { ...r, [channel]: value } : r)));
    const res = await updateNotificationPreferenceAction({ type, channels: { [channel]: value } });
    setPending((p) => {
      const next = new Set(p);
      next.delete(key);
      return next;
    });
    if (!res.ok) {
      setRows((list) => list.map((r) => (r.type === type ? { ...r, [channel]: !value } : r)));
      toast.error("Couldn't change that notification", { description: res.error.message });
      return;
    }
    const label = rows.find((r) => r.type === type)?.label ?? "Notifications";
    toast.success(`${label} ${value ? "on" : "off"} ${PHRASE[channel]}`);
  };

  const cols = "sm:grid-cols-[minmax(0,1fr)_repeat(4,4.75rem)]";
  const unavailable = channels.filter((c) => !c.available || c.note);

  return (
    <div>
      <div className={cn("hidden border-b border-border pb-2 text-xs font-medium text-muted-foreground sm:grid", cols)} aria-hidden>
        <span>Notification</span>
        {channels.map((c) => (
          <span key={c.key} className="text-center">
            {SHORT[c.key]}
            {!c.available ? <span className="block text-[11px] font-normal">Unavailable</span> : null}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.type} className={cn("flex flex-col gap-3 py-3.5 sm:grid sm:items-center sm:gap-0", cols)}>
            <div className="min-w-0 sm:pr-4">
              <p className="text-sm font-medium text-foreground">{r.label}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{r.description}</p>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:contents">
              {channels.map((c) => {
                const locked = c.key === "inApp" && r.inAppLocked;
                const checked = locked ? true : c.available ? r[c.key] : false;
                const disabled = locked || !c.available || pending.has(`${r.type}:${c.key}`);
                return (
                  <div key={c.key} className="flex flex-col items-center gap-1.5 rounded-lg bg-subtle px-1 py-2 sm:bg-transparent sm:p-0">
                    <span className="text-[11px] font-medium text-muted-foreground sm:sr-only" aria-hidden>
                      {SHORT[c.key]}
                    </span>
                    <span className="flex items-center gap-1">
                      <Switch
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(v) => toggle(r.type, c.key, v)}
                        aria-label={`${r.label} ${PHRASE[c.key]}${!c.available ? " (unavailable on this server)" : locked ? " (always on)" : ""}`}
                      />
                      {locked ? <Lock className="size-3 text-muted-foreground" aria-hidden /> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {unavailable.length || rows.some((r) => r.inAppLocked) ? (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          {unavailable.map((c) => (
            <li key={c.key}>
              <span className="font-medium text-foreground">{c.label}:</span> {c.note ?? "Not available on this server."}
            </li>
          ))}
          {rows.some((r) => r.inAppLocked) ? (
            <li className="flex items-center gap-1">
              <Lock className="size-3 shrink-0" aria-hidden /> Account and security messages always appear in Harbour.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
