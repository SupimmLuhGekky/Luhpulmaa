"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { deleteNotifications, listNotifications, markAllRead, markRead, notificationCounts, updatePreference } from "@/lib/notifications/service";

const ids = z.array(z.string().uuid()).min(1).max(100);

export interface NotificationRow {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
}

function refresh() {
  revalidatePath("/notifications");
  // The unread badge lives in the app shell header.
  revalidatePath("/", "layout");
}

/** One page of the notification centre (newest first) plus the header counts. */
export const listNotificationsAction = authedAction(
  z.object({ filter: z.enum(["all", "unread"]).default("all"), cursor: z.string().uuid().optional() }),
  async ({ filter, cursor }, user) => {
    const [page, counts] = await Promise.all([listNotifications(user.id, { unreadOnly: filter === "unread", cursor, take: 20 }), notificationCounts(user.id)]);
    return {
      counts,
      nextCursor: page.nextCursor,
      items: page.items.map(
        (n): NotificationRow => ({ id: n.id, type: n.type, severity: n.severity, title: n.title, body: n.body, href: n.href, read: Boolean(n.readAt), createdAt: n.createdAt.toISOString() }),
      ),
    };
  },
);

export const setNotificationsReadAction = authedAction(z.object({ ids, read: z.boolean() }), async ({ ids: list, read }, user) => {
  await markRead(user.id, list, read);
  refresh();
  return notificationCounts(user.id);
});

export const markAllNotificationsReadAction = authedAction(z.object({}), async (_input, user) => {
  await markAllRead(user.id);
  refresh();
  return notificationCounts(user.id);
});

export const deleteNotificationsAction = authedAction(z.object({ ids }), async ({ ids: list }, user) => {
  await deleteNotifications(user.id, list);
  refresh();
  return notificationCounts(user.id);
});

const notificationType = z.enum(["BUDGET_WARNING", "GOAL_PROGRESS", "GOAL_DEADLINE", "UPCOMING_BILL", "SUBSCRIPTION", "LARGE_TRANSACTION", "SYNC_FAILURE", "PAYDAY", "AUTOMATION", "SYSTEM"]);

export const updateNotificationPreferenceAction = authedAction(
  z.object({
    type: notificationType,
    channels: z.object({ inApp: z.boolean(), email: z.boolean(), push: z.boolean(), sms: z.boolean() }).partial().strict(),
  }),
  async ({ type, channels }, user) => {
    await updatePreference(user.id, type, channels);
    revalidatePath("/settings/notifications");
    return { type, channels };
  },
);
