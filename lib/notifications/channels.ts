import "server-only";
import type { Notification } from "@prisma/client";
import { env, isDesktop } from "@/lib/config/env";
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

export type ChannelName = "inApp" | NotificationChannel["name"];

export interface ChannelStatus {
  available: boolean;
  /** Why the channel can't be used, or a caveat when it can. */
  note?: string;
}

/**
 * Which delivery channels this server can actually use. Preferences for unavailable
 * channels are shown as unavailable and can't be switched on.
 */
export function channelAvailability(): Record<ChannelName, ChannelStatus> {
  const e = env();
  const realEmail = e.EMAIL_PROVIDER === "resend" && Boolean(e.RESEND_API_KEY);
  let email: ChannelStatus;
  if (!CHANNELS.email) email = { available: false, note: "Email delivery isn't set up on this server." };
  else if (isDesktop()) email = { available: false, note: "The Mac app keeps everything on this computer and doesn't send email." };
  else if (realEmail) email = { available: true };
  else if (e.appEnv !== "production") email = { available: true, note: "Development server: emails are written to the server log instead of being sent." };
  else email = { available: false, note: "Email delivery isn't set up on this server." };
  return {
    inApp: { available: true },
    email,
    push: CHANNELS.push ? { available: true } : { available: false, note: "Push notifications aren't set up on this server." },
    sms: CHANNELS.sms ? { available: true } : { available: false, note: "Text messages aren't set up on this server." },
  };
}
