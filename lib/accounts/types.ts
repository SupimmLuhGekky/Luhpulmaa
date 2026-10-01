import type { AccountType, ProviderType } from "@prisma/client";

export const LIABILITY_TYPES: AccountType[] = ["CREDIT_CARD", "LINE_OF_CREDIT", "LOAN", "MORTGAGE", "OTHER_LIABILITY"];
export const CASH_TYPES: AccountType[] = ["CHEQUING", "SAVINGS", "CASH"];
/** Revolving credit: these accounts can have a credit limit (and so a utilization). */
export const CREDIT_TYPES: AccountType[] = ["CREDIT_CARD", "LINE_OF_CREDIT"];

export function isLiability(type: AccountType): boolean {
  return LIABILITY_TYPES.includes(type);
}

export function hasCreditLimit(type: AccountType): boolean {
  return CREDIT_TYPES.includes(type);
}

/** Providers that don't say what kind of account each one is (their adapters set `reportsAccountTypes = false`). */
export const PERSON_TYPED_PROVIDERS: readonly ProviderType[] = ["LUNCHFLOW"];

/** The person sets the type and credit limit of manual accounts and of accounts from those providers. */
export function typeChosenByPerson(account: { isManual: boolean; provider?: ProviderType | null }): boolean {
  return account.isManual || (account.provider != null && PERSON_TYPED_PROVIDERS.includes(account.provider));
}

export type AccountGroup = "cash" | "credit" | "loans" | "investments" | "other";

export const ACCOUNT_GROUPS: { key: AccountGroup; label: string; types: AccountType[] }[] = [
  { key: "cash", label: "Cash", types: ["CHEQUING", "SAVINGS", "CASH"] },
  { key: "credit", label: "Credit cards & lines of credit", types: ["CREDIT_CARD", "LINE_OF_CREDIT"] },
  { key: "loans", label: "Loans & mortgages", types: ["LOAN", "MORTGAGE"] },
  { key: "investments", label: "Investments", types: ["INVESTMENT"] },
  { key: "other", label: "Other", types: ["OTHER_ASSET", "OTHER_LIABILITY"] },
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

/**
 * Available balance stored for a manual account: the unused credit for a card or
 * line of credit with a limit, otherwise the balance itself.
 */
export function manualAvailableBalance(type: AccountType, balanceCents: number, creditLimitCents: number | null | undefined): number {
  return hasCreditLimit(type) && creditLimitCents ? creditLimitCents - balanceCents : balanceCents;
}

/**
 * Available balance of a connected account whose provider reports only its balance (Lunch Flow):
 * the credit left when the person has set the card's limit in Harbour, otherwise unknown.
 */
export function connectedAvailableBalance(type: AccountType, balanceCents: number, creditLimitCents: number | null | undefined): number | null {
  return hasCreditLimit(type) && creditLimitCents ? creditLimitCents - balanceCents : null;
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
