import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { listNotifications, markAllRead, markRead, notificationCounts } from "@/lib/notifications/service";

export const dynamic = "force-dynamic";

/** GET /api/notifications?filter=all|unread&cursor=…&take=… — newest first, with counts. */
export const GET = apiRoute(
  { query: z.object({ filter: z.enum(["all", "unread"]).default("all"), cursor: z.string().uuid().optional(), take: z.coerce.number().int().min(1).max(100).default(30) }), rateLimitKey: "notifications" },
  async ({ user, query }) => {
    const [page, counts] = await Promise.all([listNotifications(user.id, { unreadOnly: query.filter === "unread", cursor: query.cursor, take: query.take }), notificationCounts(user.id)]);
    return {
      items: page.items.map((n) => ({ id: n.id, type: n.type, severity: n.severity, title: n.title, body: n.body, href: n.href, read: Boolean(n.readAt), createdAt: n.createdAt.toISOString() })),
      nextCursor: page.nextCursor,
      counts,
    };
  },
);

/** PATCH /api/notifications — `{ ids, read? }` marks some read/unread, `{ all: true }` marks everything read. */
export const PATCH = apiRoute(
  {
    body: z
      .object({ ids: z.array(z.string().uuid()).min(1).max(100).optional(), all: z.literal(true).optional(), read: z.boolean().default(true) })
      .strict()
      .refine((b) => Boolean(b.ids) !== Boolean(b.all), "Send either ids or all: true"),
    rateLimitKey: "notifications",
  },
  async ({ user, body }) => {
    if (body.all) {
      if (!body.read) throw new AppError("BAD_REQUEST", "Only marking everything as read is supported.");
      await markAllRead(user.id);
    } else if (body.ids) {
      await markRead(user.id, body.ids, body.read);
    }
    return notificationCounts(user.id);
  },
);
