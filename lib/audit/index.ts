import "server-only";
import { prisma } from "@/lib/db/prisma";
import { redact } from "@/lib/security/redact";
import { requestMeta } from "@/lib/security/request";
import type { Prisma } from "@prisma/client";

export type AuditAction =
  | "auth.sign_up"
  | "auth.sign_in"
  | "auth.sign_in_failed"
  | "auth.sign_out"
  | "auth.password_reset_requested"
  | "auth.password_reset"
  | "auth.password_changed"
  | "auth.email_verified"
  | "auth.session_revoked"
  | "account.connected"
  | "account.created"
  | "account.updated"
  | "account.disconnected"
  | "account.deleted"
  | "account.synced"
  | "transaction.created"
  | "transaction.updated"
  | "transaction.deleted"
  | "transaction.imported"
  | "category.created"
  | "category.updated"
  | "category.deleted"
  | "budget.created"
  | "budget.updated"
  | "budget.deleted"
  | "goal.created"
  | "goal.updated"
  | "goal.deleted"
  | "goal.contribution"
  | "automation.created"
  | "automation.updated"
  | "automation.deleted"
  | "bill.changed"
  | "subscription.changed"
  | "income.changed"
  | "settings.updated"
  | "data.exported"
  | "user.deleted";

/**
 * Records a sensitive action. Metadata is passed through `redact()` so secrets can
 * never be persisted even if a caller includes them by mistake. Failures are logged
 * but never break the user's action.
 */
export async function audit(
  userId: string | null,
  action: AuditAction,
  resource: { type: string; id?: string | null },
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const meta = await requestMeta();
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        resourceType: resource.type,
        resourceId: resource.id ?? null,
        metadata: redact(metadata) as Prisma.InputJsonValue,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record", action, error instanceof Error ? error.message : "unknown error");
  }
}
