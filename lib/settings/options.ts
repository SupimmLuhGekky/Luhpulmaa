/**
 * Client-safe option lists for settings and onboarding forms.
 */

/** What the person wants Harbour to help with (asked during onboarding, editable later). */
export const APP_GOALS = [
  { key: "track_spending", label: "See where my money goes", description: "Automatic categories and spending trends." },
  { key: "budget", label: "Stick to a budget", description: "Monthly limits with gentle alerts." },
  { key: "save", label: "Save for goals", description: "An emergency fund, a trip, a down payment…" },
  { key: "debt", label: "Pay down debt", description: "Keep credit cards and loans in view." },
  { key: "bills", label: "Never miss a bill", description: "Reminders for bills and subscriptions." },
  { key: "cash_flow", label: "Know what's safe to spend", description: "Forecasts until your next payday." },
  { key: "net_worth", label: "Track my net worth", description: "Everything you own and owe in one number." },
] as const;

export type AppGoalKey = (typeof APP_GOALS)[number]["key"];
export const APP_GOAL_KEYS = APP_GOALS.map((g) => g.key) as [AppGoalKey, ...AppGoalKey[]];

export const LOCALE_OPTIONS = [
  { value: "en-CA", label: "English (Canada)", example: "Oct 1, 2026 · $1,234.56" },
  { value: "fr-CA", label: "Français (Canada) formatting", example: "1 oct. 2026 · 1 234,56 $" },
  { value: "en-US", label: "English (United States)", example: "Oct 1, 2026 · $1,234.56" },
] as const;

export const CURRENCY_OPTIONS = [
  { value: "CAD", label: "Canadian dollar (CAD)" },
  { value: "USD", label: "US dollar (USD)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "GBP", label: "British pound (GBP)" },
] as const;

export const WEEK_START_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 6, label: "Saturday" },
] as const;

export const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match my device" },
] as const;

export const CONTRIBUTION_KIND_OPTIONS = [
  { value: "PLANNED_ALLOCATION", label: "Planned allocation", description: "You're earmarking money in your plan. Nothing moves anywhere." },
  { value: "USER_REPORTED_TRANSFER", label: "Money I moved myself", description: "You already transferred the money at your bank and are recording it here." },
] as const;

/** Readable labels for a time zone id ("America/Toronto" → "Toronto (Eastern)"). */
export const TIME_ZONE_LABELS: Record<string, string> = {
  "America/Toronto": "Toronto (Eastern)",
  "America/Montreal": "Montréal (Eastern)",
  "America/Halifax": "Halifax (Atlantic)",
  "America/St_Johns": "St. John's (Newfoundland)",
  "America/Winnipeg": "Winnipeg (Central)",
  "America/Regina": "Regina (Saskatchewan)",
  "America/Edmonton": "Edmonton (Mountain)",
  "America/Vancouver": "Vancouver (Pacific)",
  "America/Whitehorse": "Whitehorse (Yukon)",
  "America/New_York": "New York (Eastern US)",
  "America/Chicago": "Chicago (Central US)",
  "America/Denver": "Denver (Mountain US)",
  "America/Los_Angeles": "Los Angeles (Pacific US)",
  "Europe/London": "London",
  "Europe/Paris": "Paris",
  UTC: "UTC",
};

export function timeZoneLabel(tz: string): string {
  return TIME_ZONE_LABELS[tz] ?? tz.replace(/_/g, " ");
}
