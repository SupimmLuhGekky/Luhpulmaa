import "server-only";
import type { NotificationType } from "@prisma/client";
import type { Tx } from "@/lib/db/prisma";

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, { label: string; description: string }> = {
  BUDGET_WARNING: { label: "Budget alerts", description: "When a budget category crosses one of its thresholds." },
  GOAL_PROGRESS: { label: "Goal progress", description: "Milestones such as 25%, 50%, 75% and completion." },
  GOAL_DEADLINE: { label: "Goal deadlines", description: "When a goal deadline is approaching." },
  UPCOMING_BILL: { label: "Upcoming bills", description: "Reminders before bills are due." },
  SUBSCRIPTION: { label: "Subscriptions", description: "New subscriptions detected and renewal reminders." },
  LARGE_TRANSACTION: { label: "Large transactions", description: "Transactions above your large-transaction threshold." },
  SYNC_FAILURE: { label: "Account sync problems", description: "When a connected account can't be refreshed." },
  PAYDAY: { label: "Payday", description: "When a paycheque is detected." },
  AUTOMATION: { label: "Automations", description: "Notifications sent by your automations." },
  SYSTEM: { label: "Product & security", description: "Important account and security messages." },
};

export const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPE_LABELS) as NotificationType[];

export async function provisionNotificationPreferences(tx: Tx, userId: string) {
  await tx.notificationPreference.createMany({
    data: NOTIFICATION_TYPES.map((type) => ({ userId, type, inApp: true, email: type === "SYSTEM" || type === "SYNC_FAILURE" })),
    skipDuplicates: true,
  });
}
