import { Bell, Database, Globe, Landmark, Palette, PiggyBank, ShieldCheck, Tags, Target, UserRound, Workflow, type LucideIcon } from "lucide-react";

export interface SettingsItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export interface SettingsGroup {
  label: string;
  items: SettingsItem[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "Account",
    items: [
      { href: "/settings/profile", label: "Profile", description: "Name, email, province and time zone", icon: UserRound },
      { href: "/settings/security", label: "Security", description: "Password, devices and recent activity", icon: ShieldCheck },
      { href: "/settings/accounts", label: "Accounts & services", description: "Bank connections and sync status", icon: Landmark },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/settings/categories", label: "Categories", description: "Categories and merchant rules", icon: Tags },
      { href: "/settings/budget", label: "Budget", description: "Alerts, rollover and safe-to-spend", icon: PiggyBank },
      { href: "/settings/goals", label: "Goals", description: "How goal contributions are recorded", icon: Target },
      { href: "/settings/region", label: "Currency & region", description: "Currency, formatting and week start", icon: Globe },
    ],
  },
  {
    label: "App",
    items: [
      { href: "/settings/notifications", label: "Notifications", description: "What you hear about, and where", icon: Bell },
      { href: "/settings/automations", label: "Automations", description: "Rules that organise and plan for you", icon: Workflow },
      { href: "/settings/appearance", label: "Appearance", description: "Light, dark or match your device", icon: Palette },
    ],
  },
  {
    label: "Privacy",
    items: [{ href: "/settings/privacy", label: "Data & privacy", description: "Exports, AI features and account deletion", icon: Database }],
  },
];

export const SETTINGS_ITEMS = SETTINGS_GROUPS.flatMap((g) => g.items);
