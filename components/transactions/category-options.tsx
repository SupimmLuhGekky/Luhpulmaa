import type { QuickAddOptions } from "@/app/actions/shell";

const LABELS: Record<string, string> = { EXPENSE: "Spending", INCOME: "Income", TRANSFER: "Transfers" };

/**
 * <optgroup>s for a category <Select>, grouped by kind. The group that matches the
 * money's direction comes first (income categories first for money in).
 */
export function CategoryOptions({ categories, direction = "out" }: { categories: QuickAddOptions["categories"]; direction?: "in" | "out" }) {
  const order = direction === "in" ? ["INCOME", "TRANSFER", "EXPENSE"] : ["EXPENSE", "TRANSFER", "INCOME"];
  return (
    <>
      {order.map((kind) => {
        const items = categories.filter((c) => c.kind === kind);
        if (!items.length) return null;
        return (
          <optgroup key={kind} label={LABELS[kind]}>
            {items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}
