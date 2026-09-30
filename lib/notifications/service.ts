import "server-only";
import type { NotificationSeverity, NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isEnabled } from "@/lib/flags";
import { CHANNELS } from "./channels";

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  href?: string;
  /** When set, the same notification is never created twice for this user. */
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Creates an in-app notification (respecting preferences and dedupe keys) and fans
 * out to any other enabled channels. Returns null when suppressed.
 */
export async function notify(userId: string, input: NotifyInput) {
  if (!isEnabled("ENABLE_NOTIFICATIONS")) return null;
  const pref = await prisma.notificationPreference.findUnique({ where: { userId_type: { userId, type: input.type } } });
  const inApp = pref?.inApp ?? true;
  if (!inApp && !pref?.email) return null;

  if (input.dedupeKey) {
    const exists = await prisma.notification.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey: input.dedupeKey } }, select: { id: true } });
    if (exists) return null;
  }
  let notification;
  try {
    notification = await prisma.notification.create({
      data: {
        userId,
        type: input.type,
        severity: input.severity ?? "INFO",
        title: input.title,
        body: input.body,
        href: input.href,
        dedupeKey: input.dedupeKey,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        // Email-only preference: keep the record for history but mark it read.
        readAt: inApp ? null : new Date(),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return null; // concurrent dedupe
    throw error;
  }
  if (pref?.email && CHANNELS.email) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, isDemo: true } });
    if (user && !user.isDemo) await CHANNELS.email.deliver(notification, user);
  }
  return notification;
}

export async function listNotifications(userId: string, opts: { unreadOnly?: boolean; take?: number; cursor?: string } = {}) {
  const take = Math.min(opts.take ?? 30, 100);
  const items = await prisma.notification.findMany({
    where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > take;
  return { items: items.slice(0, take), nextCursor: hasMore ? items[take - 1].id : null };
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, ids: string[], read = true) {
  await prisma.notification.updateMany({ where: { userId, id: { in: ids } }, data: { readAt: read ? new Date() : null } });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

export async function deleteNotifications(userId: string, ids: string[]) {
  await prisma.notification.deleteMany({ where: { userId, id: { in: ids } } });
}

export async function updatePreference(
  userId: string,
  type: NotificationType,
  channels: Partial<{ inApp: boolean; email: boolean; push: boolean; sms: boolean }>,
) {
  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    update: channels,
    create: { userId, type, inApp: true, ...channels },
  });
}
