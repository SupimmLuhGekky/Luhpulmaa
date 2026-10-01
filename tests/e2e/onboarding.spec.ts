import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./support/app";

/** Clicks a step's button and waits for the next step to render. */
async function advance(page: Page, button: string, nextHeading: string | RegExp) {
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: nextHeading })).toBeVisible();
}

test("a new account is set up through the onboarding steps", async ({ page }) => {
  const user = await signUp(page);
  await expect(page.getByRole("heading", { level: 1, name: `Welcome to Harbour, ${user.firstName}` })).toBeVisible();
  await expect(page.getByText("Step 1 of 9")).toBeVisible();
  await advance(page, "Let's get started", "About you");

  // The profile starts from the sign-up details and Quebec defaults.
  await expect(page.getByRole("textbox", { name: "First name", exact: true })).toHaveValue(user.firstName);
  await advance(page, "Continue", "What would you like help with?");

  await page.getByRole("checkbox", { name: /^Save for goals/ }).click();
  await expect(page.getByRole("checkbox", { name: /^Save for goals/ })).toBeChecked();
  await advance(page, "Continue", "Your income");

  await page.getByRole("textbox", { name: "Amount of one paycheque", exact: true }).fill("2,000");
  await page.getByLabel("Next payday").click();
  await page.locator("td[data-today] button").click();
  await expect(page.getByRole("radio", { name: /^Every 2 weeks/ })).toHaveAttribute("aria-checked", "true");
  await advance(page, "Continue", "Your accounts");

  // With no accounts yet, the manual account form is already open.
  await page.getByRole("textbox", { name: "Account name", exact: true }).fill("Fictional chequing");
  await page.getByRole("textbox", { name: "Balance today", exact: true }).fill("1,500");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(page.getByText("Fictional chequing added")).toBeVisible();
  const added = page.getByRole("region", { name: /^Added so far/ });
  await expect(added.getByRole("listitem").filter({ hasText: "Fictional chequing" })).toContainText("$1,500.00");
  await advance(page, "Continue", /^A first budget for /);

  // Amounts are suggested from the income entered above.
  await expect(page.getByText(/^Suggested from your income of \$4,333\.33 a month/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Budget lines" }).getByRole("listitem").first()).toBeVisible();
  await advance(page, "Create budget", "A first savings goal");

  await page.getByRole("radio", { name: "Something else" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Fictional canoe trip");
  await page.getByRole("textbox", { name: "Amount to save", exact: true }).fill("1,800");
  await advance(page, "Create goal", "What should Harbour tell you about?");
  await advance(page, "Save and continue", `You're all set, ${user.firstName}`);

  // The summary shows what each step saved.
  const summary = page.locator("dl");
  await expect(summary).toContainText("$2,000.00");
  await expect(summary).toContainText("1 account: Fictional chequing");
  await expect(summary).toContainText(/categories, \$[\d,]+ planned/);
  await expect(summary).toContainText("Fictional canoe trip ($1,800)");

  await page.getByRole("button", { name: "Go to my dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^Good (morning|afternoon|evening), ${user.firstName}$`) })).toBeVisible();
  await expect(page.getByRole("main").getByText("Fictional canoe trip").first()).toBeVisible();

  // Setup is finished, so the app no longer sends this person back to it.
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
});
