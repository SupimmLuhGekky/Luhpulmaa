import { expect, test } from "@playwright/test";
import { newUser, open } from "./support/app";

// Fictional bank export: one café purchase the automation should catch, one it should not.
const CSV = ["Date,Description,Amount", "2026-09-02,FICTIONAL CORNER CAFE,-4.75", "2026-09-05,FICTIONAL GROCER #123,-56.20", ""].join("\n");

test("an automation built in the builder files new transactions as described", async ({ page }) => {
  await newUser(page);
  await open(page, "/automations/new");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Fictional coffee runs");
  await expect(page.getByRole("radio", { name: /^A transaction is added/ })).toHaveAttribute("aria-checked", "true");
  // A new automation starts with one "merchant contains" condition and a "set the category" action.
  await expect(page.getByRole("combobox", { name: "Condition 1 field" }).locator("option:checked")).toHaveText("Merchant");
  await page.getByRole("textbox", { name: "Condition 1 text" }).fill("corner cafe");
  await expect(page.getByRole("combobox", { name: "Action 1" }).locator("option:checked")).toHaveText("Set the category");
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption({ label: "Restaurants" });
  await page.getByRole("combobox", { name: "Subcategory", exact: true }).selectOption({ label: "Coffee" });
  await page.getByRole("button", { name: "Add an action" }).click();
  await page.getByRole("combobox", { name: "Action 2" }).selectOption({ label: "Add a tag" });
  await page.getByRole("textbox", { name: "Tag", exact: true }).fill("coffee runs");
  await page.getByRole("button", { name: "Create automation" }).click();

  await expect(page.getByText("“Fictional coffee runs” created")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Fictional coffee runs" })).toBeVisible();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[^/?]+$/);
  const automationUrl = page.url();
  await open(page, "/automations");
  await expect(page.getByRole("main").getByText("Fictional coffee runs").first()).toBeVisible();

  // Transactions added afterwards go through it: here, a CSV import into a new account.
  await open(page, "/transactions/import");
  await page.getByRole("textbox", { name: "Account name", exact: true }).fill("Fictional Everyday Chequing");
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption({ label: "Chequing / everyday account" });
  await page.getByLabel("CSV file").setInputFiles({ name: "fictional-bank.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.getByRole("button", { name: "Check for duplicates" }).click();
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByText("Imported 2 transactions")).toBeVisible();
  await page.getByRole("link", { name: "View transactions" }).click();
  await expect(page).toHaveURL(/\/transactions\?account=/);

  await page.getByRole("button", { name: "Fictional Corner Cafe", exact: true }).click();
  const cafe = page.getByRole("dialog", { name: "Fictional Corner Cafe" });
  await expect(cafe.getByText("Categorized by an automation")).toBeVisible();
  await expect(cafe.getByRole("combobox", { name: "Category", exact: true }).locator("option:checked")).toHaveText("Restaurants");
  await expect(cafe.getByRole("textbox", { name: "Tags", exact: true })).toHaveValue("coffee runs");
  await page.keyboard.press("Escape");
  await expect(cafe).toBeHidden();

  // The grocer didn't match, so it has no tag.
  await page.getByRole("button", { name: "Fictional Grocer", exact: true }).click();
  const grocer = page.getByRole("dialog", { name: "Fictional Grocer" });
  await expect(grocer.getByRole("textbox", { name: "Tags", exact: true })).toHaveValue("");
  await expect(grocer.getByText("Categorized by an automation")).toHaveCount(0);

  // The automation's history lists the one run.
  await open(page, `${automationUrl}?tab=history`);
  await expect(page.getByRole("tab", { name: "History · 1" })).toBeVisible();
  await expect(page.getByRole("tabpanel").getByRole("link", { name: "Fictional Corner Cafe" })).toBeVisible();
});
