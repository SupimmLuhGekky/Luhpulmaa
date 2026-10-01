"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import { listAccounts } from "@/lib/accounts/service";
import { listCategories } from "@/lib/categories/service";
import { listNotifications, markAllRead, markRead, unreadCount } from "@/lib/notifications/service";

export interface QuickAddOptions {
  accounts: { id: string; name: string; type: string; mask: string | null; isLiability: boolean }[];
  categories: { id: string; name: string; icon: string; color: string; kind: string; subcategories: { id: string; name: string }[] }[];
}

/** Accounts and categories for the transaction form, loaded when a form opens. */
export const transactionFormOptionsAction = authedAction(z.object({}), async (_input, user): Promise<QuickAddOptions> => {
  const [accounts, categories] = await Promise.all([listAccounts(user.id), listCategories(user.id)]);
  return {
    accounts: accounts
      .filter((a) => a.status !== "DISCONNECTED" && a.status !== "CLOSED")
      .map((a) => ({ id: a.id, name: a.name, type: a.type, mask: a.mask, isLiability: a.isLiability })),
    categories: categories
      .filter((c) => !c.isHidden)
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, kind: c.kind, subcategories: c.subcategories.map((s) => ({ id: s.id, name: s.name })) })),
  };
});

export interface NotificationItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
}

export const recentNotificationsAction = authedAction(z.object({ take: z.number().int().min(1).max(20).default(8) }), async ({ take }, user) => {
  const [{ items }, unread] = await Promise.all([listNotifications(user.id, { take }), unreadCount(user.id)]);
  return {
    unread,
    items: items.map(
      (n): NotificationItem => ({ id: n.id, type: n.type, severity: n.severity, title: n.title, body: n.body, href: n.href, read: Boolean(n.readAt), createdAt: n.createdAt.toISOString() }),
    ),
  };
});

export const markNotificationsReadAction = authedAction(z.object({ ids: z.array(z.string().uuid()).max(100).optional(), all: z.boolean().optional() }), async ({ ids, all }, user) => {
  if (all) await markAllRead(user.id);
  else if (ids?.length) await markRead(user.id, ids);
  revalidatePath("/", "layout");
  return { unread: await unreadCount(user.id) };
});
