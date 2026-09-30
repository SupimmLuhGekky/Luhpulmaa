import "server-only";
import { env } from "@/lib/config/env";

/**
 * Feature flags. Each flag is read from the environment and falls back to a
 * sensible default. Flags are evaluated server-side and passed to client components
 * as plain booleans when needed.
 */
export const FLAG_NAMES = [
  "ENABLE_BANKING",
  "ENABLE_AUTOMATIONS",
  "ENABLE_NOTIFICATIONS",
  "ENABLE_AI_CATEGORIZATION",
  "ENABLE_AI_ASSISTANT",
  "ENABLE_MULTI_CURRENCY",
  "ENABLE_CSV_IMPORT",
  "DEMO_MODE",
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];
export type Flags = Record<FlagName, boolean>;

const DEFAULTS: Flags = {
  ENABLE_BANKING: true,
  ENABLE_AUTOMATIONS: true,
  ENABLE_NOTIFICATIONS: true,
  ENABLE_AI_CATEGORIZATION: false,
  ENABLE_AI_ASSISTANT: false,
  ENABLE_MULTI_CURRENCY: false,
  ENABLE_CSV_IMPORT: true,
  DEMO_MODE: false,
};

export function flags(): Flags {
  const e = env();
  const out = { ...DEFAULTS };
  for (const name of FLAG_NAMES) {
    const value = e[name];
    if (typeof value === "boolean") out[name] = value;
  }
  // Demo mode is on by default outside production so the app is explorable immediately.
  if (e.DEMO_MODE === undefined && e.appEnv !== "production") out.DEMO_MODE = true;
  return out;
}

export function isEnabled(name: FlagName): boolean {
  return flags()[name];
}
