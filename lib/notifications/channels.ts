import "server-only";
import type { Notification } from "@prisma/client";
import { sendEmail } from "@/lib/email";

/**
 * Delivery channels beyond the in-app notification centre. Email is wired to the
 * email adapter; push and SMS are extension points (implement `deliver` with e.g.
 * Web Push / APNs / FCM or Twilio and register them in CHANNELS).
 */
export interface NotificationChannel {
  name: "email" | "push" | "sms";
  deliver(notification: Notification, recipient: { email: string }): Promise<void>;
}

const emailChannel: NotificationChannel = {
  name: "email",
  async deliver(n, recipient) {
    await sendEmail({ to: recipient.email, subject: n.title, text: `${n.body}\n\n— Harbour` });
  },
};

export const CHANNELS: Record<NotificationChannel["name"], NotificationChannel | null> = {
  email: emailChannel,
  push: null,
  sms: null,
};
