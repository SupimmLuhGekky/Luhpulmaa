import { expect, test } from "@playwright/test";
import { open, signInAsDemo } from "./support/app";

// Pages in the navigation that exist so far, with their headings.
const PAGES = [
  ["/accounts", "Accounts"],
  ["/transactions", "Transactions"],
  ["/budget", "Budget"],
  ["/goals", "Goals"],
  ["/income", "Income"],
  ["/bills", "Bills"],
  ["/subscriptions", "Subscriptions"],
  ["/forecast", "Cash flow"],
  ["/analytics", "Analytics"],
  ["/net-worth", "Net worth"],
] as const;

test("every page in the navigation opens for the demo account", async ({ page }) => {
  test.slow(); // the dev server compiles each page on its first visit
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(`${page.url()}: ${error.message}`));
  await signInAsDemo(page);
  for (const [path, heading] of PAGES) {
    await test.step(path, async () => {
      await open(page, path);
      await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
      await expect(page.getByText("We couldn't load this page")).toHaveCount(0);
    });
  }
  expect(crashes).toEqual([]);
});
