import { expect, test } from "@playwright/test";
import { newUser, open } from "./support/app";

test("a goal can be created from /goals?new=1 and given a planned contribution", async ({ page }) => {
  await newUser(page);
  await open(page, "/goals?new=1");
  const dialog = page.getByRole("dialog", { name: "New goal" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Fictional kayak");
  await dialog.getByRole("textbox", { name: "Target", exact: true }).fill("1,200");
  await dialog.getByRole("button", { name: "Create goal" }).click();

  await expect(page.getByText("Goal created")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/goals$/);
  await page.getByRole("link", { name: "Fictional kayak", exact: true }).click();

  await expect(page).toHaveURL(/\/goals\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Fictional kayak" })).toBeVisible();
  await page.getByRole("button", { name: "Add money", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add money to Fictional kayak" });
  // Planned is the default: money earmarked in Harbour, nothing moves between accounts.
  await expect(add.getByRole("radio", { name: "Planned" })).toHaveAttribute("aria-checked", "true");
  await add.getByRole("textbox", { name: "Amount", exact: true }).fill("250");
  await add.getByRole("button", { name: "Add $250.00" }).click();

  await expect(page.getByText("Added $250.00 (planned)")).toBeVisible();
  await expect(add).toBeHidden();
  await expect(page.getByRole("progressbar", { name: "Fictional kayak progress" })).toHaveAttribute("aria-valuetext", "20%: $0.00 actual and $250.00 planned of $1,200.00");
  await expect(page.getByText("$950.00 to go")).toBeVisible();
  // The history lists the entry as planned money (the toast is outside <main>).
  await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: "$250.00" }).filter({ hasText: "Planned" })).toBeVisible();
});
