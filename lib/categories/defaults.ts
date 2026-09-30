import type { CategoryKind } from "@prisma/client";

export interface DefaultCategory {
  key: string;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  subcategories?: string[];
  /** Counts as an essential need for safe-to-spend reservations. */
  essential?: boolean;
}

/** Built-in categories created for every new user. All are editable afterwards. */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { key: "housing", name: "Housing", kind: "EXPENSE", icon: "home", color: "#6366f1", subcategories: ["Rent", "Mortgage", "Maintenance"], essential: true },
  { key: "utilities", name: "Utilities", kind: "EXPENSE", icon: "zap", color: "#f59e0b", subcategories: ["Electricity", "Internet", "Phone", "Water"], essential: true },
  { key: "groceries", name: "Groceries", kind: "EXPENSE", icon: "shopping-basket", color: "#22c55e", essential: true },
  { key: "restaurants", name: "Restaurants", kind: "EXPENSE", icon: "utensils", color: "#f97316", subcategories: ["Dining out", "Delivery", "Coffee"] },
  { key: "transportation", name: "Transportation", kind: "EXPENSE", icon: "bus", color: "#0ea5e9", subcategories: ["Public transit", "Rideshare", "Parking", "Car maintenance"], essential: true },
  { key: "gas", name: "Gas", kind: "EXPENSE", icon: "fuel", color: "#0891b2", essential: true },
  { key: "shopping", name: "Shopping", kind: "EXPENSE", icon: "shopping-bag", color: "#ec4899", subcategories: ["Clothing", "Electronics", "Home"] },
  { key: "entertainment", name: "Entertainment", kind: "EXPENSE", icon: "clapperboard", color: "#a855f7", subcategories: ["Events", "Games", "Hobbies"] },
  { key: "subscriptions", name: "Subscriptions", kind: "EXPENSE", icon: "repeat", color: "#8b5cf6", subcategories: ["Streaming", "Software", "Memberships"] },
  { key: "healthcare", name: "Healthcare", kind: "EXPENSE", icon: "heart-pulse", color: "#ef4444", subcategories: ["Pharmacy", "Dental", "Vision"], essential: true },
  { key: "insurance", name: "Insurance", kind: "EXPENSE", icon: "shield", color: "#14b8a6", subcategories: ["Auto", "Home/Tenant", "Life"], essential: true },
  { key: "education", name: "Education", kind: "EXPENSE", icon: "graduation-cap", color: "#3b82f6" },
  { key: "travel", name: "Travel", kind: "EXPENSE", icon: "plane", color: "#06b6d4" },
  { key: "personal", name: "Personal", kind: "EXPENSE", icon: "user", color: "#d946ef", subcategories: ["Personal care", "Gifts", "Donations"] },
  { key: "fees", name: "Fees", kind: "EXPENSE", icon: "receipt", color: "#78716c", subcategories: ["Bank fees", "Interest"] },
  { key: "other", name: "Other", kind: "EXPENSE", icon: "circle-dashed", color: "#64748b" },
  { key: "income", name: "Income", kind: "INCOME", icon: "wallet", color: "#10b981", subcategories: ["Salary", "Freelance", "Interest", "Refunds", "Government benefits"] },
  { key: "transfers", name: "Transfers", kind: "TRANSFER", icon: "arrow-left-right", color: "#94a3b8", subcategories: ["Between accounts", "Credit card payment", "Savings"] },
];

export const ESSENTIAL_CATEGORY_KEYS = new Set(DEFAULT_CATEGORIES.filter((c) => c.essential).map((c) => c.key));

/** Icon names users can pick from (all available in lucide-react; see components/shared/category-icon). */
export const CATEGORY_ICON_CHOICES = [
  "home", "zap", "shopping-basket", "utensils", "coffee", "bus", "car", "fuel", "shopping-bag", "clapperboard",
  "repeat", "heart-pulse", "shield", "graduation-cap", "plane", "user", "receipt", "circle-dashed", "wallet",
  "arrow-left-right", "gift", "baby", "dog", "dumbbell", "music", "gamepad-2", "book", "briefcase", "smartphone",
  "wifi", "piggy-bank", "landmark", "sparkles", "shirt", "wrench", "circle",
] as const;

export const CATEGORY_COLOR_CHOICES = [
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#ef4444", "#f97316", "#f59e0b",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#64748b",
] as const;
