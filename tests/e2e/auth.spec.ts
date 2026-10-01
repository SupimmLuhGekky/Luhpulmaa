import { expect, test } from "@playwright/test";
import { DEMO, signInAsDemo, signUp } from "./support/app";

const DASHBOARD_CARDS = [
  "Safe to spend",
  "Cash",
  "Net worth",
  "Income & spending",
  "Spending by category",
  "Savings goals",
  "Upcoming bills",
  "Budget",
  "Cash flow",
  "Subscriptions",
  "Recent transactions",
  "Insights",
];

test("signing up sends the new person to onboarding", async ({ page }) => {
  await signUp(page);
  // The app keeps sending them there until onboarding is finished.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("the demo account signs in to a dashboard showing every card", async ({ page }) => {
  await signInAsDemo(page);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^Good (morning|afternoon|evening), ${DEMO.firstName}$`) })).toBeVisible();
  for (const title of DASHBOARD_CARDS) {
    await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByText("We couldn't load this page")).toHaveCount(0);
});
