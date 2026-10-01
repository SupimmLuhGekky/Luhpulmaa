import { expect, test, type Page } from "@playwright/test";
import { newUser, open } from "./support/app";
import { FAKE_LUNCHFLOW_KEY } from "./support/env";

/**
 * Lunch Flow, against the local stand-in for its API (support/fake-lunchflow.mjs):
 * a fictional Neo card owing $523.10 with three posted transactions and one pending,
 * and an everyday account holding $1,840.25 with two transactions.
 */

/** "YYYY-MM-DD", `days` from today in UTC, as the stand-in dates its transactions. */
function day(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Opens "Connect Lunch Flow", checks the stand-in's key and returns the account choices. */
async function checkKey(page: Page) {
  await open(page, "/accounts/new?method=connect");
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect Lunch Flow" });
  await dialog.getByLabel("Lunch Flow API key").fill(FAKE_LUNCHFLOW_KEY);
  await dialog.getByRole("button", { name: "Check key" }).click();
  return page.getByRole("dialog", { name: "Choose what to bring in" });
}

test("connects Lunch Flow with an API key and imports its posted transactions", async ({ page }) => {
  await newUser(page);
  await open(page, "/accounts/new?method=connect");
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect Lunch Flow" });

  // A key Lunch Flow refuses is reported, and nothing is saved.
  await dialog.getByLabel("Lunch Flow API key").fill("lf-fictional-wrong-key");
  await dialog.getByRole("button", { name: "Check key" }).click();
  await expect(dialog.getByText(/^Lunch Flow didn't accept the API key\./)).toBeVisible();

  await dialog.getByLabel("Lunch Flow API key").fill(FAKE_LUNCHFLOW_KEY);
  await dialog.getByRole("button", { name: "Check key" }).click();
  const choose = page.getByRole("dialog", { name: "Choose what to bring in" });

  // Lunch Flow doesn't say what kind of account each one is: Harbour suggests from the name.
  const card = choose.getByRole("group", { name: /^Fictional Neo Mastercard/ });
  await expect(card.getByRole("combobox", { name: "Type" })).toHaveValue("CREDIT_CARD");
  await expect(card).toContainText("Owed $523.10");
  const everyday = choose.getByRole("group", { name: /^Fictional Everyday Account/ });
  await expect(everyday.getByRole("combobox", { name: "Type" })).toHaveValue("CHEQUING");
  await expect(everyday).toContainText("Balance $1,840.25");
  await choose.getByRole("button", { name: "Connect", exact: true }).click();

  // Five posted transactions; the pending one waits until it posts.
  const done = page.getByRole("dialog", { name: "All set" });
  await expect(done.getByText("Fictional Neo Financial is connected", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(done.getByText("2 accounts · 5 new transactions imported")).toBeVisible();
  await done.getByRole("button", { name: "Done" }).click();

  await open(page, "/accounts");
  await expect(page.getByText("Through Lunch Flow")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Fictional Neo Mastercard\b/ })).toContainText("$523.10");
  await expect(page.getByRole("link", { name: /^Fictional Everyday Account\b/ })).toContainText("$1,840.25");

  await open(page, "/transactions");
  await expect(page.getByText("5 transactions", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fictional Corner Cafe", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fictional Bistro", exact: true })).toHaveCount(0);
});

test("Lunch Flow continues an account imported from CSV files without doubling its transactions", async ({ page }) => {
  await newUser(page);
  const csv = ["Date,Description,Amount", `${day(-2)},FICTIONAL CORNER CAFE,-5.25`, `${day(-40)},FICTIONAL BOOKSHOP,-19.99`, ""].join("\n");
  await open(page, "/transactions/import");
  await page.getByRole("textbox", { name: "Account name", exact: true }).fill("Fictional Neo card");
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption({ label: "Credit card" });
  await page.getByLabel("CSV file").setInputFiles({ name: "fictional-neo.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Check for duplicates" }).click();
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByText("Imported 2 transactions")).toBeVisible();

  const choose = await checkKey(page);
  // The card's CSV account is suggested, so its history continues instead of being copied.
  const card = choose.getByRole("group", { name: /^Fictional Neo Mastercard/ });
  await expect(card.getByRole("combobox", { name: "Bring it in as" }).locator("option:checked")).toHaveText("Fictional Neo card (2 transactions)");
  await choose
    .getByRole("group", { name: /^Fictional Everyday Account/ })
    .getByRole("combobox", { name: "Bring it in as" })
    .selectOption({ label: "Don't import" });
  await choose.getByRole("button", { name: "Connect", exact: true }).click();

  // The café is already there from the CSV file: only the grocer and the payment are new.
  const done = page.getByRole("dialog", { name: "All set" });
  await expect(done.getByText("1 account · 2 new transactions imported")).toBeVisible({ timeout: 60_000 });
  await done.getByRole("button", { name: "Done" }).click();

  await open(page, "/accounts");
  await expect(page.getByRole("link", { name: /^Fictional Neo card\b/ })).toContainText("$523.10");
  await expect(page.getByRole("link", { name: /^Fictional Everyday Account\b/ })).toHaveCount(0);

  await open(page, "/transactions");
  await expect(page.getByText("4 transactions", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fictional Corner Cafe", exact: true })).toHaveCount(1);
});
