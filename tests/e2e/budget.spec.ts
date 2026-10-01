import { expect, test } from "@playwright/test";
import { currentMonth, newUser, open, stat } from "./support/app";

test("a monthly budget can be created from /budget?new=1 and given a line", async ({ page }) => {
  await newUser(page);
  await open(page, "/budget?new=1");
  const dialog = page.getByRole("dialog", { name: "New budget" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Monthly" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("textbox", { name: "Planned income", exact: true }).fill("4,000");
  await dialog.getByRole("button", { name: "Create budget" }).click();

  await expect(page.getByText("Budget created")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/budget\\?month=${currentMonth()}$`));
  await expect(stat(page, "Planned income")).toContainText("$4,000.00");
  await expect(page.getByText("No lines yet")).toBeVisible();

  await page.getByRole("button", { name: "Add a line" }).click();
  const line = page.getByRole("dialog", { name: "Add a budget line" });
  await line.getByRole("combobox", { name: "Category", exact: true }).selectOption({ label: "Groceries" });
  await line.getByRole("textbox", { name: "Amount per month", exact: true }).fill("600");
  await line.getByRole("button", { name: "Add line" }).click();

  await expect(page.getByText("Budget line added")).toBeVisible();
  await expect(line).toBeHidden();
  await expect(page.getByRole("button", { name: /^Groceries ?, edit line$/ })).toBeVisible();
  await expect(stat(page, "Budgeted")).toContainText("$600.00");
  await expect(stat(page, "Left to spend")).toContainText("$600.00");
});
