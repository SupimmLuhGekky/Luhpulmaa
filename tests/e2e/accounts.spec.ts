import { expect, test } from "@playwright/test";
import { newUser, open } from "./support/app";

test("connecting a simulated bank brings in its accounts and transactions", async ({ page }) => {
  await newUser(page);
  await open(page, "/accounts/new?method=connect");
  await expect(page.getByRole("heading", { name: "Connect a bank" })).toBeVisible();
  await expect(page.getByText("These banks are simulated")).toBeVisible();

  await page.getByRole("list", { name: "Simulated banks" }).getByRole("button", { name: "Connect Maple Trust (Demo)" }).click();
  // The first import runs the whole pipeline over six months of simulated history.
  await expect(page.getByText("Maple Trust (Demo) is connected", { exact: true })).toBeVisible({ timeout: 150_000 });
  const summary = await page.getByText(/^3 accounts · [\d,]+ new transactions imported$/).innerText();
  const imported = Number(summary.replace(/^3 accounts · /, "").replace(/ new transactions imported$/, "").replace(/,/g, ""));
  expect(imported).toBeGreaterThan(100);

  await open(page, "/accounts");
  for (const name of ["Everyday Chequing", "High Interest Savings", "Cashback Visa"]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${name}\\b`) })).toBeVisible();
  }

  // Every imported transaction is listed.
  await open(page, "/transactions");
  await expect(page.getByText(`${imported.toLocaleString("en-CA")} transactions`, { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search transactions" }).fill("Netflix");
  await expect(page).toHaveURL(/[?&]q=Netflix\b/);
  await expect(page.getByRole("row").filter({ hasText: "Cashback Visa" }).filter({ hasText: "-$22.99" }).first()).toBeVisible();
});
