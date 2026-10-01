import {
  Activity, ArrowLeftRight, CalendarDays, ChartColumn, HandCoins, Landmark, LayoutDashboard, PiggyBank, Repeat, Settings, Sparkles, Target, TrendingUp, Workflow,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Feature flag that must be on for the item to show. */
  flag?: "assistant" | "automations";
}

export interface NavSection {
  label: string | null;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/accounts", label: "Accounts", icon: Landmark },
      { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Plan",
    items: [
      { href: "/budget", label: "Budget", icon: PiggyBank },
      { href: "/goals", label: "Goals", icon: Target },
      { href: "/income", label: "Income", icon: HandCoins },
      { href: "/bills", label: "Bills", icon: CalendarDays },
      { href: "/subscriptions", label: "Subscriptions", icon: Repeat },
      { href: "/forecast", label: "Cash flow", icon: Activity },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", icon: ChartColumn },
      { href: "/net-worth", label: "Net worth", icon: TrendingUp },
      { href: "/automations", label: "Automations", icon: Workflow, flag: "automations" },
      { href: "/assistant", label: "Assistant", icon: Sparkles, flag: "assistant" },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings };

/** Bottom navigation on phones: the four most-used destinations plus "More". */
export const MOBILE_PRIMARY = ["/dashboard", "/transactions", "/budget", "/goals"];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
