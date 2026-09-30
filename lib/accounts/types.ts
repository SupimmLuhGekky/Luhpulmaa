import type { AccountType } from "@prisma/client";

export const LIABILITY_TYPES: AccountType[] = ["CREDIT_CARD", "LINE_OF_CREDIT", "LOAN", "MORTGAGE", "OTHER_LIABILITY"];
export const CASH_TYPES: AccountType[] = ["CHEQUING", "SAVINGS", "CASH"];

export function isLiability(type: AccountType): boolean {
  return LIABILITY_TYPES.includes(type);
}

export type AccountGroup = "cash" | "credit" | "loans" | "investments" | "other";

export const ACCOUNT_GROUPS: { key: AccountGroup; label: string; types: AccountType[] }[] = [
  { key: "cash", label: "Cash", types: ["CHEQUING", "SAVINGS", "CASH"] },
  { key: "credit", label: "Credit cards", types: ["CREDIT_CARD", "LINE_OF_CREDIT"] },
  { key: "loans", label: "Loans", types: ["LOAN", "MORTGAGE", "OTHER_LIABILITY"] },
  { key: "investments", label: "Investments", types: ["INVESTMENT"] },
  { key: "other", label: "Other assets", types: ["OTHER_ASSET"] },
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CHEQUING: "Chequing",
  SAVINGS: "Savings",
  CASH: "Cash",
  CREDIT_CARD: "Credit card",
  LINE_OF_CREDIT: "Line of credit",
  LOAN: "Loan",
  MORTGAGE: "Mortgage",
  INVESTMENT: "Investment",
  OTHER_ASSET: "Other asset",
  OTHER_LIABILITY: "Other liability",
};

export function groupOf(type: AccountType): AccountGroup {
  return ACCOUNT_GROUPS.find((g) => g.types.includes(type))?.key ?? "other";
}

export function netWorthGroup(type: AccountType): "cash" | "investments" | "otherAssets" | "creditCards" | "loans" | "otherLiabilities" {
  switch (type) {
    case "CHEQUING":
    case "SAVINGS":
    case "CASH":
      return "cash";
    case "INVESTMENT":
      return "investments";
    case "CREDIT_CARD":
    case "LINE_OF_CREDIT":
      return "creditCards";
    case "LOAN":
    case "MORTGAGE":
      return "loans";
    case "OTHER_LIABILITY":
      return "otherLiabilities";
    default:
      return "otherAssets";
  }
}
