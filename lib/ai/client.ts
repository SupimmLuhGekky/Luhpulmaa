import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/config/env";

/**
 * Optional AI layer. Nothing in the core product depends on it: every AI feature is
 * behind a feature flag, requires ANTHROPIC_API_KEY, and requires the user to opt in
 * (Settings → Data & Privacy). The model never receives another user's data and has
 * no tool that can move money.
 */
export const AI_MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;

export function aiClient(): Anthropic | null {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) return null;
  client ??= new Anthropic({ apiKey: key });
  return client;
}
