import type { Metadata } from "next";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { listNotifications, notificationCounts } from "@/lib/notifications/service";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { NotificationCenter, type NotificationFilter } from "@/components/notifications/notification-center";
import type { NotificationRow } from "@/app/actions/notifications";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireOnboardedUser();
  const filter: NotificationFilter = (await searchParams).filter === "unread" ? "unread" : "all";
  const [page, counts] = await Promise.all([listNotifications(user.id, { unreadOnly: filter === "unread", take: 20 }), notificationCounts(user.id)]);
  const items: NotificationRow[] = page.items.map((n) => ({
    id: n.id,
    type: n.type,
    severity: n.severity,
    title: n.title,
    body: n.body,
    href: n.href,
    read: Boolean(n.readAt),
    createdAt: n.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Notifications"
        description={counts.unread ? `${counts.unread} unread` : "You're all caught up."}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/notifications">
              <Settings2 /> Preferences
            </Link>
          </Button>
        }
      />
      <NotificationCenter key={filter} filter={filter} initial={{ items, nextCursor: page.nextCursor, counts }} />
    </div>
  );
}
