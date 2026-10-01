import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Pages that show account balances or transactions from accounts. Called after any
 * account or connection change (a sync or deletion also adds or removes transactions).
 */
export function revalidateAccountViews() {
  revalidatePath("/accounts", "layout");
  for (const path of ["/dashboard", "/transactions", "/net-worth", "/budget", "/analytics", "/goals", "/forecast", "/settings"]) revalidatePath(path);
}
