import { expect, test } from "@playwright/test";
import { newUser, open, signInAsDemo } from "./support/app";

test("a transaction's category can be changed in the drawer", async ({ page }) => {
  await signInAsDemo(page);
  await open(page, "/transactions");
  await page.getByRole("searchbox", { name: "Search transactions" }).fill("Netflix");
  await expect(page).toHaveURL(/[?&]q=Netflix\b/);

  const netflix = page.getByRole("button", { name: "Netflix", exact: true }).first();
  await netflix.click();
  const drawer = page.getByRole("dialog", { name: "Netflix" });
  const category = drawer.getByRole("combobox", { name: "Category", exact: true });
  await expect(category).toBeVisible();
  // The seeded charge is in Subscriptions; move it somewhere else (also on a re-run).
  const before = (await category.locator("option:checked").innerText()).trim();
  const after = before === "Entertainment" ? "Shopping" : "Entertainment";
  await category.selectOption({ label: after });
  await drawer.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Transaction updated")).toBeVisible();
  await expect(drawer.getByText("Changed by you")).toBeVisible();
  const id = new URL(page.url()).searchParams.get("txn");
  expect(id).toBeTruthy();

  // Reloaded from the server: the list and the drawer both show the new category.
  await open(page, "/transactions?q=Netflix");
  await expect(page.getByRole("row").filter({ has: page.getByRole("button", { name: "Netflix", exact: true }) }).first()).toContainText(after);
  await open(page, `/transactions?q=Netflix&txn=${id}`);
  await expect(page.getByRole("dialog", { name: "Netflix" }).getByRole("combobox", { name: "Category", exact: true }).locator("option:checked")).toHaveText(after);
});

// Fictional bank export: two purchases and a paycheque.
const CSV = ["Date,Description,Amount", "2026-09-02,FICTIONAL CORNER CAFE,-4.75", "2026-09-05,FICTIONAL GROCER #123,-56.20", "2026-09-15,FICTIONAL EMPLOYER PAYROLL,1500.00", ""].join("\n");

test("a small CSV file can be imported into a new account", async ({ page }) => {
  await newUser(page);
  await open(page, "/transactions/import");
  // No accounts yet, so the wizard creates one from the file step.
  await page.getByRole("textbox", { name: "Account name", exact: true }).fill("Fictional Everyday Chequing");
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption({ label: "Chequing / everyday account" });
  await page.getByLabel("CSV file").setInputFiles({ name: "fictional-bank.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });

  await expect(page.getByRole("heading", { name: "Match the columns" })).toBeVisible();
  await expect(page.getByText("fictional-bank.csv · 3 rows · into Fictional Everyday Chequing")).toBeVisible();
  await page.getByRole("button", { name: "Check for duplicates" }).click();

  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(page.getByText("Imported 3 transactions")).toBeVisible();
  await expect(page.getByText("Everything in the file was new.")).toBeVisible();

  await page.getByRole("link", { name: "View transactions" }).click();
  await expect(page).toHaveURL(/\/transactions\?account=/);
  await expect(page.getByText("3 transactions", { exact: true })).toBeVisible();
  await expect(page.getByText("In $1,500.00 · Out $60.95")).toBeVisible();
  for (const [name, amount] of [
    ["Fictional Employer Payroll", "+$1,500.00"],
    ["Fictional Grocer", "-$56.20"],
    ["Fictional Corner Cafe", "-$4.75"],
  ]) {
    await expect(page.getByRole("row").filter({ has: page.getByRole("button", { name, exact: true }) })).toContainText(amount);
  }
});
