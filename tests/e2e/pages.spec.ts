import { expect, test, type Page } from "@playwright/test";
import { open, signInAsDemo } from "./support/app";

// Pages in the navigation, with their headings.
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
  ["/automations", "Automations"],
  ["/notifications", "Notifications"],
] as const;

const SETTINGS = [
  ["/settings", "Settings"],
  ["/settings/profile", "Profile"],
  ["/settings/security", "Security"],
  ["/settings/accounts", "Accounts & connected services"],
  ["/settings/categories", "Categories"],
  ["/settings/budget", "Budget"],
  ["/settings/goals", "Goals"],
  ["/settings/region", "Currency & region"],
  ["/settings/notifications", "Notifications"],
  ["/settings/automations", "Automations"],
  ["/settings/appearance", "Appearance"],
  ["/settings/privacy", "Data & privacy"],
] as const;

/** Opens each page as the demo account and checks its heading, with no error screen or page crash. */
async function openEach(page: Page, pages: readonly (readonly [string, string])[]) {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(`${page.url()}: ${error.message}`));
  await signInAsDemo(page);
  for (const [path, heading] of pages) {
    await test.step(path, async () => {
      await open(page, path);
      await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
      await expect(page.getByText("We couldn't load this page")).toHaveCount(0);
    });
  }
  expect(crashes).toEqual([]);
}

test("every page in the navigation opens for the demo account", async ({ page }) => {
  test.slow(); // the dev server compiles each page on its first visit
  await openEach(page, PAGES);
});

test("every settings section opens for the demo account", async ({ page }) => {
  test.slow();
  await openEach(page, SETTINGS);
});
