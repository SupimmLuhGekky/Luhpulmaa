import { z } from "zod";

export const DASHBOARD_WIDGETS = [
  { id: "safeToSpend", label: "Safe to spend" },
  { id: "netWorth", label: "Net worth" },
  { id: "cash", label: "Cash" },
  { id: "incomeSpending", label: "Income & spending" },
  { id: "budget", label: "Budget" },
  { id: "goals", label: "Savings goals" },
  { id: "bills", label: "Upcoming bills" },
  { id: "spendingBreakdown", label: "Spending breakdown" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "cashFlow", label: "Cash flow" },
  { id: "recentTransactions", label: "Recent transactions" },
  { id: "insights", label: "Insights" },
] as const;

export type WidgetId = (typeof DASHBOARD_WIDGETS)[number]["id"];
const widgetIds = DASHBOARD_WIDGETS.map((w) => w.id) as [WidgetId, ...WidgetId[]];

export const dashboardLayoutSchema = z.object({
  widgets: z.array(z.object({ id: z.enum(widgetIds), visible: z.boolean() })).max(DASHBOARD_WIDGETS.length),
});

export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

/** Default order. On mobile the dashboard renders in this order: safe to spend, cash, spending, goals, bills. */
export const DEFAULT_LAYOUT: DashboardLayout = {
  widgets: [
    { id: "safeToSpend", visible: true },
    { id: "cash", visible: true },
    { id: "netWorth", visible: true },
    { id: "incomeSpending", visible: true },
    { id: "spendingBreakdown", visible: true },
    { id: "goals", visible: true },
    { id: "bills", visible: true },
    { id: "budget", visible: true },
    { id: "cashFlow", visible: true },
    { id: "subscriptions", visible: true },
    { id: "recentTransactions", visible: true },
    { id: "insights", visible: true },
  ],
};

/** Merges a stored layout with the defaults so new widgets appear and unknown ones are dropped. */
export function resolveLayout(raw: unknown): DashboardLayout {
  const parsed = dashboardLayoutSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_LAYOUT;
  const seen = new Set<string>();
  const widgets = parsed.data.widgets.filter((w) => !seen.has(w.id) && seen.add(w.id));
  for (const d of DEFAULT_LAYOUT.widgets) if (!seen.has(d.id)) widgets.push(d);
  return { widgets };
}
