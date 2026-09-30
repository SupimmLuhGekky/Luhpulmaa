import "server-only";
import { env } from "@/lib/config/env";

/**
 * Transactional email. Adapters:
 *  - console (default in development/test): prints the message to the server log so
 *    verification/reset links can be followed locally.
 *  - resend: sends through the Resend HTTP API (set EMAIL_PROVIDER=resend, RESEND_API_KEY).
 * Add SES/Postmark/SMTP by implementing `EmailAdapter`.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}

class ConsoleAdapter implements EmailAdapter {
  async send(message: EmailMessage) {
    if (env().appEnv === "production") {
      console.warn("[email] console adapter in production — message not delivered:", message.subject);
      return;
    }
    console.info(`\n──── email to ${message.to} ────\nSubject: ${message.subject}\n\n${message.text}\n────────────────────────────\n`);
  }
}

class ResendAdapter implements EmailAdapter {
  constructor(private apiKey: string, private from: string) {}

  async send(message: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: message.to, subject: message.subject, text: message.text, html: message.html }),
    });
    if (!res.ok) throw new Error(`Email provider responded with ${res.status}`);
  }
}

function adapter(): EmailAdapter {
  const e = env();
  if (e.EMAIL_PROVIDER === "resend" && e.RESEND_API_KEY) return new ResendAdapter(e.RESEND_API_KEY, e.EMAIL_FROM);
  return new ConsoleAdapter();
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  try {
    await adapter().send(message);
  } catch (error) {
    console.error("[email] send failed:", error instanceof Error ? error.message : "unknown");
  }
}

export function appUrl(path: string): string {
  return new URL(path, env().APP_URL).toString();
}
