/**
 * Export kinds and file names. Client-safe (used by the Data & privacy settings page).
 */
export const EXPORT_TYPES = ["transactions", "budget", "goals", "contributions", "summary", "accounts", "all"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export const EXPORT_INFO: Record<ExportType, { label: string; description: string; format: "CSV" | "ZIP" }> = {
  transactions: { label: "Transactions", description: "Every transaction with its account, category, tags and notes.", format: "CSV" },
  budget: { label: "Budget", description: "Budgeted, spent and remaining per category for one month.", format: "CSV" },
  goals: { label: "Savings goals", description: "Targets, progress, deadlines and required contributions.", format: "CSV" },
  contributions: { label: "Goal contributions", description: "Planned allocations and transfers you recorded, by date.", format: "CSV" },
  summary: { label: "Financial summary", description: "Income, spending, savings rate and categories for the last year.", format: "CSV" },
  accounts: { label: "Accounts", description: "Account names, types and the latest balances Harbour has.", format: "CSV" },
  all: { label: "Everything", description: "All of the above plus bills and subscriptions, as CSV files in one ZIP.", format: "ZIP" },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "harbour-transactions-2026-01-01_2026-09-30.csv", "harbour-budget-2026-10.csv", "harbour-export-2026-10-01.zip". */
export function exportFileName(type: ExportType, today: string, opts: { month?: string; from?: string; to?: string } = {}): string {
  switch (type) {
    case "transactions": {
      const from = opts.from && DATE.test(opts.from) ? opts.from : null;
      const to = opts.to && DATE.test(opts.to) ? opts.to : null;
      return from || to ? `harbour-transactions-${from ?? "start"}_${to ?? today}.csv` : `harbour-transactions-${today}.csv`;
    }
    case "budget":
      return `harbour-budget-${opts.month && /^\d{4}-\d{2}$/.test(opts.month) ? opts.month : today.slice(0, 7)}.csv`;
    case "contributions":
      return `harbour-goal-contributions-${today}.csv`;
    case "all":
      return `harbour-export-${today}.zip`;
    default:
      return `harbour-${type}-${today}.csv`;
  }
}

/** Content-Disposition value for a download (file names here are ASCII by construction). */
export function attachmentHeader(filename: string): string {
  const safe = filename.replace(/[^\w.\-]/g, "_");
  return `attachment; filename="${safe}"`;
}
